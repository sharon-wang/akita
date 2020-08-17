/**
 * Content scripts can only see a "clean version" of the DOM, i.e. a version of the DOM without
 * properties which are added by JavaScript, such as document.monetization!
 * reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#Content_script_environment
 *			  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
 * So we must inject some code into the JavaScript context of the current tab in order to
 * access the document.monetization object. We inject code using a script element:
 */
const scriptEl = document.createElement('script');
scriptEl.text = `
	if (document.monetization) {
		document.monetization.addEventListener('monetizationstart', (event) => {
			document.dispatchEvent(new CustomEvent('akita_monetizationstart', { detail: event.detail }));
		});

		document.monetization.addEventListener('monetizationprogress', (event) => {
			document.dispatchEvent(new CustomEvent('akita_monetizationprogress', { detail: event.detail }));
		});

		document.monetization.addEventListener('monetizationstop', (event) => {
			document.dispatchEvent(new CustomEvent('akita_monetizationstop', { detail: event.detail }));
		});
	}
`;
document.body.appendChild(scriptEl);


setExtensionIconMonetizationState(false);
main();

/**
 * Main function to initiate the application.
 */
async function main() {
	// TODO: check payment pointer periodically for existence and validity
	const {
		isValid,
		paymentPointer
	} = await getAndValidatePaymentPointer();

	setExtensionIconMonetizationState(isValid);

	// paymentPointer will be null if it doesn't exist or is invalid
	await storeDataIntoAkitaFormat({ paymentPointer: paymentPointer }, AKITA_DATA_TYPE.PAYMENT);

	// Test storing assets
	// await storeDataIntoAkitaFormat({
	// 	paymentPointer: paymentPointer,
	// 	assetCode: "USD",
	// 	assetScale: 9,
	// 	amount: 123456
	// }, AKITA_DATA_TYPE.PAYMENT);

	document.addEventListener('akita_monetizationprogress', (event) => {
		storeDataIntoAkitaFormat(event.detail, AKITA_DATA_TYPE.PAYMENT);
	});
	//document.addEventListener('akita_monetizationstop', (event) => {
	//	storeDataIntoAkitaFormat(null, AKITA_DATA_TYPE.PAYMENT);
	//});

	await trackTimeOnSite();
	await trackVisitToSite();

	// For TESTING purposes: output all stored data to the console (not including current site)
	// loadAllData().then(result => console.log(JSON.stringify(result, null, 2)));
}

/***********************************************************
 * Extension Icon
 ***********************************************************/

/**
 * Sends a message to background_script.js which changes the extension icon.
 * Only background scripts have access to the extension icon API.
 *
 * @param {boolean} isCurrentlyMonetized Changes the browser icon to indicate whether the site is monetized or not.
 *   If true, a pink $ badge is displayed. If false, just the dog face without the tongue is used as the icon.
 */
function setExtensionIconMonetizationState(isCurrentlyMonetized) {
	const webBrowser = chrome ? chrome : browser;
	webBrowser.runtime.sendMessage({ isCurrentlyMonetized });
}

/***********************************************************
 * Track Visits and Time Spent on Website
 ***********************************************************/

/**
 * Track the current visit to the site (origin) and store the favicon to the site.
 * No data needs to be passed in, since it is handled in AkitaOriginVisitData.
 */
async function trackVisitToSite() {
	await storeDataIntoAkitaFormat(null, AKITA_DATA_TYPE.ORIGIN_VISIT_DATA);
	await storeFaviconPath();
}

/**
 * Calculate and store the time the user spends on the site.
 * Call this function once at the beginning of website logic.
 * 
 * Use the Page Visibility API to check if the current webpage is visible or not.
 * https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
 * https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
 */
async function trackTimeOnSite() {
	let previousStoreTime = getCurrentTime();
	let docHiddenTime = -1;
	let docVisibleTime = -1;

	document.addEventListener('visibilitychange', async (event) => {
		if (document.hidden) {
			// The page is no longer visible
			docHiddenTime = getCurrentTime();
		} else {
			// The page is now visible
			docVisibleTime = getCurrentTime();

			const {
				isValid,
				paymentPointer
			} = await getAndValidatePaymentPointer();
			setExtensionIconMonetizationState(isValid);
		}
	});

	/**
	 * NOTE: setInterval may not be called while the document is hidden (while visibility lost)
	 * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout#Reasons_for_delays_longer_than_specified
	 * 
	 * Store the recent time spent every 2 seconds to ensure time spent on site is recorded
	 * even if the user closes the site.
	 */
	setInterval(async () => {
		const now = getCurrentTime();

		if (document.visibilityState === 'visible') {
			if (docHiddenTime > previousStoreTime) {
				// Adding time after visibility lost (document becomes hidden) and then gained (document is visible again)
				// i.e. If the user navigates away from the site and then comes back
				const timeFromPreviousStoreToDocHidden = docHiddenTime - previousStoreTime;
				const timeSinceDocVisible = now - docVisibleTime;
				await storeRecentTimeSpent(timeFromPreviousStoreToDocHidden + timeSinceDocVisible);
			} else {
				// Adding time during regular interval (document visible)
				await storeRecentTimeSpent(now - previousStoreTime);
			}

			previousStoreTime = now;
		}
	}, 2000); // 2 second interval
}

/**
 * Get the current time based on the user's timezone.
 */
function getCurrentTime() {
	return performance.now();
}

/**
 * Store the recent time spent in the webpage session into AkitaFormat.
 * 
 * @param {Number} recentTimeSpent The recent time spent on the webpage. This number is
 * a Double, since performance.now() is used to construct this number.
 */
async function storeRecentTimeSpent(recentTimeSpent) {
	// Round the number up so that it is a whole number.
	const recentTimeSpentRounded = Math.ceil(recentTimeSpent);

	await storeDataIntoAkitaFormat(recentTimeSpentRounded, AKITA_DATA_TYPE.ORIGIN_TIME_SPENT);
}

/***********************************************************
 * Validate Payment Pointer
 ***********************************************************/

/**
 * Check for a monetization meta tag on the website and verify that
 * the payment pointer is valid (resolves to a valid SPSP endpoint).
 * 
 * TODO: use enum to indicate no meta tag, meta tag + valid endpoint,
 * meta tag + invalid endpoint.
 * 
 * @return {Promise<{ isPaymentPointerValid: boolean, paymentPointer:string}>}
 * isPaymentPointerValid is true if both monetization is present and the payment endpoint is valid.
 * paymentPointer is the paymentPointer if it is found in the monetization meta tag, otherwise null.
 */
async function getAndValidatePaymentPointer() {
	const monetizationMeta = document.querySelector('meta[name="monetization"]');
	let paymentPointer = (monetizationMeta) ? monetizationMeta.content : null;
	let isValid = false;

	if (null === monetizationMeta) {
		/* No monetization meta tag provided */
	} else {
		if (await isPaymentPointerValid(paymentPointer)) {
			isValid = true;
		}
	}

	return {
		isValid,
		paymentPointer
	};
}

/**
 * Check if a payment pointer is valid or not.
 * 
 * @param {string} paymentPointer The paymentPointer found in a meta tag.
 * @return {Promise<boolean>} Whether or not the specified payment pointer is valid.
 */
async function isPaymentPointerValid(paymentPointer) {
	let isPaymentPointerValid = false;

	/**
	 * A maximum of five redirections is the recommendation as per
	 * https://www.ietf.org/rfc/rfc2616.txt
	 */
	let redirectCounter = 5;
	let response = null;
	let endpoint = null;
	let paymentPointerCandidate = paymentPointer;

	while (redirectCounter > 0) {
		endpoint = resolvePaymentPointer(paymentPointerCandidate);

		if (endpoint) {
			response = await httpGet(endpoint, "Accept", "application/spsp4+json, application/spsp+json");

			if (response.status === 200) {
				/* HTTP Status OK */
				isPaymentPointerValid = true;
				break;
			} else if ((response.status >= 300) && (response.status < 400)) {
				/* HTTP Status Redirect */
				// get redirect location from repsonse header
				// reponse.headers
				// cannot get location from client-side script
				// https://stackoverflow.com/questions/42662571/client-side-how-do-i-get-the-location-header-of-any-website
				// https://stackoverflow.com/questions/38927335/how-to-get-header-location-value-from-a-fetch-request-in-browser
				paymentPointerCandidate = newlocation;
				redirectCounter--;

				// need to validate that the response body contains destination_account and shared_secret
				// {"destination_account":"g.uphold.internalMultiChild.172-31-48-236.stream.Ghn5ESBkSHt4gHrZf6x4v1JiILma2vXHwQpLoiqwDoI.qoaOUISg2K7WWmxabcMCL4GDxwWRfnBAW34kXW_PI8X5rV8hYYRV43U-we0wwlCHPkRmZ-sDijYC8ojJJwWS7BEAxNGP57JYnzm5W5aDqek38OBLNsm5vS7xsiUYmATp7qc1pVcjEllHt0lzkG49_YdVWxBoFvhqcNO8",
				// "shared_secret":"56ygfMJgR4DxpYwa6kCIcckprJOIV4en20pWPCp8E4w="}
			}
		}
	}

	return isPaymentPointerValid;
}

/**
 * Resolve a payment pointer into an SPSP endpoint.
 * 
 * Payment pointer format: "$" host path-abempty
 * Resolution format: "https://" host path-abempty
 * 
 * SPSP Endpoint Specification: https://interledger.org/rfcs/0009-simple-payment-setup-protocol/#specification
 * Payment pointer syntax resolution examples: https://paymentpointers.org/syntax-resolution/#examples
 * Refer to https://paymentpointers.org/ for resolution details.
 * 
 * @param {string} paymentPointer The paymentPointer found in a meta tag.
 * @return {string} The resolved payment pointer.
 */
function resolvePaymentPointer(paymentPointer) {
	let resolvedPaymentPointer = null;

	if (paymentPointer) {
		resolvedPaymentPointer = paymentPointer.trim();

		const httpsURL = "https://";
		// The first character of the payment pointer should be '$'
		if ('$' === resolvedPaymentPointer.charAt(0)) {
			// Remove '$' from the resolved payment pointer
			resolvedPaymentPointer = resolvedPaymentPointer.substr(1);

			const wellKnownPath = ".well-known/pay";
			const pathabemptyIndex = resolvedPaymentPointer.indexOf('/');

			// If no custom path is specified, append /.well-known/pay to the endpoint, otherwise keep the path as is
			if (-1 == pathabemptyIndex) {
				// There is no path specified for the payment pointer; eg. $pointer.exampleILPwalletprovider.com
				resolvedPaymentPointer.concat("/" + wellKnownPath);
			} else if ((resolvedPaymentPointer.length - 1) == pathabemptyIndex) {
				// There is no path specified for the payment pointer, but it ends in a forward slash; eg. $pointer.exampleILPwalletprovider.com/
				resolvedPaymentPointer.concat(wellKnownPath);
			} else {
				// Path is specified for the payment pointer - keep the path as is;
				// eg. $pointer.exampleILPwalletprovider.com/customPath or $pointer.exampleILPwalletprovider.com/customPath/
			}

			// Payment pointers must resolve to an https URL, as per: https://tools.ietf.org/html/rfc7230#section-2.7.2
			resolvedPaymentPointer = httpsURL.concat(resolvedPaymentPointer);
		} else if (resolvedPaymentPointer.startsWith(httpsURL)) {
			// An https:// payment pointer was provided, so it is "already resolved"
		} else {
			resolvedPaymentPointer = null;
		}
	}

	return resolvedPaymentPointer;
}

/**
 * Send an asynchronous http request to the provided endpoint with a header if specified.
 * 
 * TODO: add handling for multiple header values.
 * 
 * @param {string} endpoint The URL to make an http request against.
 * @param {string} headerName The name of the header.
 * @param {string} headerValue The value for the header.
 * @return {Promise<Response>} The http response returned by the server.
 */
async function httpGet(endpoint, headerName, headerValue) {
	let response = null;

	if (endpoint) {
		let requestHeaders = new Headers();

		if (headerName && headerValue) {
			requestHeaders.append(headerName, headerValue);
		}

		response = await fetch(endpoint, {
			method: 'GET',
			headers: requestHeaders,
			redirect: 'manual' // Handle redirects manually since we want to validate the payment pointer
		});
	}

	return response;
}

/***********************************************************
 * Get Website Favicon
 ***********************************************************/

/**
 * Store the favicon path into storage.
 */
async function storeFaviconPath() {
	// TODO: only update favicon source if the path to the favicon has not changed
	await storeDataIntoAkitaFormat(getFaviconPath(), AKITA_DATA_TYPE.ORIGIN_FAVICON);
}

/**
 * Retrieve the favicon path.
 * 
 * @return {String} The absolute or relative path from the site origin to the favicon.
 */
function getFaviconPath() {
	// Default favicon path is at the root of the origin
	let faviconPath = null;
	let linkElementsList = document.getElementsByTagName("link");
	let relIconFoundIndex = -1;

	// Check for a link with rel "icon" or "shortcut icon"
	for (let i = 0; i < linkElementsList.length; i++) {
		const linkElementRel = linkElementsList[i].getAttribute("rel");

		if (linkElementRel === "shortcut icon") {
			// Specifically check for "shortcut icon" since the href tends to be a direct link
			faviconPath = linkElementsList[i].getAttribute("href");
			break;
		} else if (linkElementRel === "icon") {
			relIconFoundIndex = i;
		}
	}

	if (faviconPath) {
		// "shortcut icon" was found, faviconPath already set
	} else if (relIconFoundIndex !== -1) {
		// The "icon" link was found, set path to specified href
		faviconPath = linkElementsList[relIconFoundIndex].getAttribute("href");
	} else {
		// An icon link was not found, set path to default
		faviconPath = "favicon.ico";
	}

	return faviconPath;
}
