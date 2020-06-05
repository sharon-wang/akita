/**
 * Holds calculated origin stats based on data stored in Akita.
 * 
 * Refer to originStats in example_data.json for an example.
 * 
 * Origin stats include:
 *   - total time spent at all origins since using Akita (in milliseconds)
 *   - total time spent at all monetized origins since using Akita (in milliseconds)
 *   - total number of visits to all origins recorded in Akita
 *   - total number of visits to monetized origins recorded in Akita
 *   - list of top 5 monetized origins by visit time (ordered by amount of time spent)
 *   - list of top 5 monetized origins that "need some love" (TODO: DEFINE WHAT THIS MEANS)
 *   - map of totalSentAssets, with an entry for each currency
 */
class AkitaOriginStats {
	ORIGIN_RANKING_FIRST = 1;
	ORIGIN_RANKING_LAST = 5;

	totalTimeSpent = 0;
	totalMonetizedTimeSpent = 0;
	totalVisits = 0;
	totalMonetizedVisits = 0;

	// The type of each entry in topOriginsMap is: AkitaOriginData
	topOriginsMap = {};

	// The type of each entry in needsSomeLoveMap is: AkitaOriginData
	needsSomeLoveMap = {};

	// The type of each entry in totalSentAssetsMap is: WebMonetizationAsset
	totalSentAssetsMap = {};

	/**
	 * This function takes an object with the same properties as AkitaOriginStats,
	 * i.e. an AkitaOriginStats instance which has been stored and loaded from browser storage,
	 * and copies the object's properties over to an AkitaOriginStats instance.
	 *
	 * @param {Object} akitaOriginStats an object with the same properties as an AkitaOriginStats object.
	 * @return {AkitaOriginStats} the input object as an instance of the AkitaOriginStats class.
	 */
	static fromObject(akitaOriginStats) {
		const newAkitaOriginStats = new AkitaOriginStats();

		newAkitaOriginStats.totalTimeSpent = akitaOriginStats.totalTimeSpent;
		newAkitaOriginStats.totalMonetizedTimeSpent = akitaOriginStats.totalMonetizedTimeSpent;
		newAkitaOriginStats.totalVisits = akitaOriginStats.totalVisits;
		newAkitaOriginStats.totalMonetizedVisits = akitaOriginStats.totalMonetizedVisits;
		
		for (const origin in akitaOriginStats.topOriginsMap) {
			if (akitaOriginStats.topOriginsMap[origin]) {
				newAkitaOriginStats.topOriginsMap[origin] = AkitaOriginData.fromObject(
					akitaOriginStats.topOriginsMap[origin]
				);
			}
		}

		for (const origin in akitaOriginStats.needsSomeLoveMap) {
			if (akitaOriginStats.needsSomeLoveMap[origin]) {
				newAkitaOriginStats.needsSomeLoveMap[origin] = AkitaOriginData.fromObject(
					akitaOriginStats.needsSomeLoveMap[origin]
				);
			}
		}

		for (const assetCode in akitaOriginStats.totalSentAssetsMap) {
			newAkitaOriginStats.totalSentAssetsMap[assetCode] = WebMonetizationAsset.fromObject(
				akitaOriginStats.totalSentAssetsMap[assetCode]
			);
		}

		return newAkitaOriginStats;
	}

	/***********************************************************
	 * Update Time Spent
	 ***********************************************************/

	/**
	 * Update the total monetized time spent if the origin is monetized; update
	 * the total time spent regardless. Also update the top origins map if the
	 * origin data is exceptional enough.
	 * 
	 * @param {Number} recentTimeSpent The new amount of time spent at the origin.
	 * @param {AkitaOriginData} originData The origin data object.
	 */
	updateTimeSpent(recentTimeSpent, originData) {
		this.maybeUpdateTopOriginsMap(originData);
		this.updateTotalTimeSpent(recentTimeSpent);	

		if (originData.isCurrentlyMonetized) {
			this.updateTotalMonetizedTimeSpent(recentTimeSpent);
			
		}
	}

	/**
	 * Update the total time spent at all origins.
	 * 
	 * @param {Number} recentTimeSpent The new amount of time spent at the origin.
	 */
	updateTotalTimeSpent(recentTimeSpent) {
		this.totalTimeSpent += recentTimeSpent;
	}

	/**
	 * Update the total time spent at monetized origins.
	 * 
	 * @param {Number} recentTimeSpent The new amount of time spent at the origin.
	 */
	updateTotalMonetizedTimeSpent(recentTimeSpent) {
		this.totalMonetizedTimeSpent += recentTimeSpent;
	}

	/***********************************************************
	 * Update Visits
	 ***********************************************************/

	/**
	 * Update the total visits to monetized origins if the origin is monetized,
	 * and update the total visits to origins regardless.
	 * 
	 * @param {Boolean} originisCurrentlyMonetized Whether the origin is monetized or not.
	 */
	incrementVisits(originisCurrentlyMonetized) {
		if (originisCurrentlyMonetized) {
			this.incrementTotalMonetizedVisits();
		}
		this.incrementTotalVisits();
	}

	/**
	 * Increment the total visits to origins.
	 */
	incrementTotalVisits() {
		this.totalVisits += 1;
	}

	/**
	 * Increment the total visits to monetized origins.
	 */
	incrementTotalMonetizedVisits() {
		this.totalMonetizedVisits += 1;
	}

	/***********************************************************
	 * Update Top 5 Monetized Origins Map
	 ***********************************************************/

	maybeUpdateTopOriginsMap(topOriginsContender) {
		if (topOriginsContender.isCurrentlyMonetized) {
			const timeSpentAtContender = topOriginsContender.originVisitData.timeSpentAtOrigin;

			if (timeSpentAtContender > 0) {
				// ranking is the place in topOriginsMap (1..5), with 1 being 1st place and 5 being 5th place
				// ranking is defined as ORIGIN_RANKING_FIRST to ORIGIN_RANKING_LAST (1 to 5)
				const ranking = this.contenderBattlesOriginAt(this.ORIGIN_RANKING_FIRST, timeSpentAtContender);

				if (ranking > this.ORIGIN_RANKING_LAST) {
					// Contender didn't make the top 5 :(
				} else if (!this.topOriginsMap[ranking]) {
					// Contender placed in top 5 at topOriginsMap[ranking] since it had no competition at that ranking
					this.topOriginsMap[ranking] = topOriginsContender;
				} else {
					// Contender placed in top 5 at topOriginsMap[ranking]
					if (topOriginsContender.origin === this.topOriginsMap[ranking].origin) {
						// Contender is replacing itself with its new data
						this.topOriginsMap[ranking] = topOriginsContender;
					} else {
						// Contender is squeezing an origin out of the top 5
						this.reorderTopOriginsMap(ranking, topOriginsContender);
					}
				}
			}
		}
	}

	contenderBattlesOriginAt(ranking, timeSpentAtContender) {
		console.log("first pos: " + ranking);
		
		// If we haven't already compared against all top 5 origins
		// or there is no current holder at the ranking
		// or an origin exists in the ranking in the map
		// and the time spent at the contender is greater than an existing top 5 time
		if ((ranking > this.ORIGIN_RANKING_LAST)
			|| (!this.topOriginsMap[ranking])
			|| (ranking <= this.ORIGIN_RANKING_LAST
				&& this.topOriginsMap[ranking]
				&& timeSpentAtContender > this.topOriginsMap[ranking].originVisitData.timeSpentAtOrigin)
		) {
			return ranking;
		} else {
			// Increment the ranking by 1 and have the contender compete with the origin in the next ranking
			return this.contenderBattlesOriginAt(ranking + 1, timeSpentAtContender);
		}
	}

	reorderTopOriginsMap(ranking, replacementOrigin) {
		// If the ranking is <= ORIGIN_RANKING_LAST, then we haven't finished reordering
		if (ranking <= this.ORIGIN_RANKING_LAST) {
			// Get the origin currently at topOriginsMap[ranking]
			const currentOrigin = this.topOriginsMap[ranking];
			console.log("CURRENT ", currentOrigin);
			console.log("REPLACEMENT ", replacementOrigin);

			// Replace that ranking with the replacementOrigin
			this.topOriginsMap[ranking] = replacementOrigin;
	
			// Replace the origin in the next ranking with currentOrigin
			this.reorderTopOriginsMap(ranking + 1, currentOrigin);
		} else {
			return;
		}
	}

	/***********************************************************
	 * Update Top 5 Needs Some Love Map
	 ***********************************************************/

	maybeUpdateNeedsSomeLoveMap(newneedsSomeLoveMap) {
		this.needsSomeLoveMap = newneedsSomeLoveMap;
	}

	/***********************************************************
	 * Update Total Sent Assets Map
	 ***********************************************************/

	/**
	 * Update the total sent assets map by adding the amount to an existing
	 * asset (currency) or create a new asset in the total sent assets map.
	 * 
	 * @param {{
	 *	paymentPointer: String,
	 *	amount?: Number,
	 *	assetScale?: Number,
	 *	assetCode?: String
	 * }} paymentData
	 *	 This object may be created, or a Web Monetization event detail object can be used.
	 *	 Pass in an object with just a paymentPointer to register a payment pointer for
	 *	 the current website. Payment pointer should be validated first.
	 *	 Additionally pass in assetCode, assetScale, and amount together to add to the
	 *	 total amount sent to the current website.
	 *
	 *	 assetCode e.g. 'XRP', 'USD', 'CAD'
	 *	 assetScale and amount e.g.
	 *		 if assetCode is 'USD', amount is 235, assetScale is 3 then actual amount of
	 *		 currency is 235 * 10**(-3) = $0.235 USD or twenty-three and one-half cents.
	 *
	 *	 reference: https://webmonetization.org/docs/api#example-event-object-3
	 */
	updateAssetsMapWithAsset({
		paymentPointer,
		amount = null,
		assetScale = null,
		assetCode = null
	}) {
		if (!isNaN(amount) && !isNaN(assetScale) && assetCode) {
			if (!this.totalSentAssetsMap[assetCode]) {
				this.totalSentAssetsMap[assetCode] = new WebMonetizationAsset(assetCode);
			}
			this.totalSentAssetsMap[assetCode].addAmount(amount, assetScale);
		}
	}
}