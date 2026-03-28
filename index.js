import {
	SmppHttpBridge,
	mockInjectInboundSms,
	startMockSmscServer,
} from "./middleware.js";

const config = {
	smppHost: process.env.SMPP_HOST || "127.0.0.1",
	smppPort: Number(process.env.SMPP_PORT || 2775),
	systemId: process.env.SMPP_SYSTEM_ID || "tsupersaver-esme",
	password: process.env.SMPP_PASSWORD || "password",
	sourceAddr: process.env.SMPP_SOURCE_ADDR || "TsuperSaver",
	backendUrl: process.env.BACKEND_URL || "http://127.0.0.1:3000/api/v1/sms",
};

async function main() {
	// Default path for demo: simple mode without SMPP bind.
	const mockMode = process.env.MOCK_MODE === "true";
	const useSmpp = process.env.USE_SMPP === "true";

	const bridge = new SmppHttpBridge(config);

	if (useSmpp) {
		await bridge.startSmpp();
	} else {
		console.log("[main] running in simple mode (no SMPP connection)");
	}

	if (mockMode) {
		startMockSmscServer();
	}

	if (mockMode) {
		// Simulate inbound SMS flow without telecom dependency.
		setTimeout(async () => {
			try {
				await mockInjectInboundSms(bridge);
				console.log("[demo] mock inbound SMS injected");
			} catch (err) {
				console.error("[demo] injection failed:", err.message);
			}
		}, 1200);
	}

	if (process.env.DEMO_OUTBOUND === "true") {
		setTimeout(async () => {
			try {
				await bridge.sendSmsFromBackend({
					to: "639171234567",
					sessionId: "demo-session-1",
					text: "14.577,120.99|7E",
					payload: {
						note: "Optional extra metadata",
					},
				});
				console.log("[demo] mock outbound SMS submitted");
			} catch (err) {
				console.error("[demo] outbound send failed:", err.message);
			}
		}, 3500);
	}
}

main().catch((err) => {
	console.error("[main] fatal error:", err);
	process.exit(1);
});
