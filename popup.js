//test code
document.getElementById("test-notification-button").addEventListener("click", function testNotification() {
	const testNotificationId = "test-notification";
	let webBrowser = chrome ? chrome : browser;

	webBrowser.notifications.create(testNotificationId, {
		"type": "basic",
		"iconUrl": "icon.png",
		"title": "just testing notifications",
		"message": "hello hello is anyone out there?"
	});

	webBrowser.browserAction.onClicked.addListener(()=> {
		var clearing = webBrowser.notifications.clear(testNotificationId);
		clearing.then(() => {
		console.log("cleared");
		});
	});
});
