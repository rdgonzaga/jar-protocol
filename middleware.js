import { SimpleSmsProtocol } from "./protocol.js";

export class SmppHttpBridge {
	constructor(config = {}) {
		this.config = {
			backendUrl: config.backendUrl || "http://127.0.0.1:3000/api/v1/sms",
			smppHost: config.smppHost || "127.0.0.1",
			smppPort: Number(config.smppPort || 2775),
			systemId: config.systemId || "tsupersaver-esme",
			password: config.password || "password",
			sourceAddr: config.sourceAddr || "TsuperSaver",
		};

		// protocol parser/encoder for SMS text frames
		this.protocol = new SimpleSmsProtocol();
		this.session = null;
		this.smpp = null;
	}

	async startSmpp() {
		// lazy import that keeps simple/mock mode runnable even if SMPP is unused.
		const mod = await import("smpp");
		this.smpp = mod.default;

		this.session = this.smpp.connect({
			url: `smpp://${this.config.smppHost}:${this.config.smppPort}`,
		});

		this.session.on("connect", () => {
			this.session.bind_transceiver(
				{ system_id: this.config.systemId, password: this.config.password },
				(pdu) => {
					if (pdu.command_status !== 0) {
						console.error("[bridge] bind failed", pdu.command_status);
						return;
					}
					console.log("[bridge] bind success");
				},
			);
		});

		this.session.on("pdu", async (pdu) => {
			if (pdu.command !== "deliver_sm") {
				return;
			}
			await this.handleDeliverSm(pdu);
			this.session.deliver_sm_resp({ sequence_number: pdu.sequence_number });
		});

		this.session.on("error", (err) =>
			console.error("[bridge] SMPP error:", err.message),
		);
	}

	getTextFromPdu(pdu) {
		if (pdu.short_message) {
			return Buffer.isBuffer(pdu.short_message)
				? pdu.short_message.toString("utf8")
				: String(pdu.short_message);
		}
		if (pdu.message_payload) {
			return Buffer.isBuffer(pdu.message_payload)
				? pdu.message_payload.toString("utf8")
				: String(pdu.message_payload);
		}
		return "";
	}

	async handleDeliverSm(pdu) {
		const from = String(pdu.source_addr || "");
		const to = String(pdu.destination_addr || "");
		const text = this.getTextFromPdu(pdu);
		return this.handleIncomingText({ from, to, text });
	}

	async handleIncomingText({ from, to, text }) {
		if (!text) {
			return;
		}

		// reassembles multipart SMS until complete
		const decoded = this.protocol.decode(text);
		if (!decoded.done) {
			console.log(
				`[bridge] waiting parts ${decoded.part}/${decoded.total} id=${decoded.id}`,
			);
			return;
		}

		// this should be equal with our implementation
		// on the post api { sessionId, text }.
		const body = this.toOnlineApiRequest(decoded.data);

		const response = await fetch(this.config.backendUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`backend HTTP ${response.status}`);
		}

		console.log(
			`[bridge] forwarded msgId=${decoded.id} sessionId=${body.sessionId}`,
		);
	}

	toOnlineApiRequest(data) {
		const payload = this.tryParseJson(data.p || "{}");

		const sessionId =
			data.s || data.sessionId || payload.sessionId || `offline-${Date.now()}`;

		const text =
			this.safeDecodeURIComponent(data.x || "") ||
			data.text ||
			payload.text ||
			this.buildSmsTextFromPayload(payload) ||
			"HELP";

		return { sessionId, text };
	}

	buildSmsTextFromPayload(payload) {
		if (!payload || typeof payload !== "object") {
			return "";
		}

		// preferred shape from mobile app payload
		if (payload.gps && payload.command) {
			return `${payload.gps}|${payload.command}`;
		}

		if (
			payload.currentLat != null &&
			payload.currentLng != null &&
			payload.routeCode
		) {
			return `${payload.currentLat},${payload.currentLng}|${payload.routeCode}`;
		}

		if (payload.command) {
			return String(payload.command);
		}

		return "";
	}

	tryParseJson(raw) {
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	}

	safeDecodeURIComponent(value) {
		if (!value) {
			return "";
		}
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	encodeAppMessage({ sessionId = "", text = "", payload = {} }) {
		// compact transport keys: s=sessionId, x=text, p=optional JSON
		return this.protocol.encode({
			s: sessionId,
			x: encodeURIComponent(text),
			p: JSON.stringify(payload),
		});
	}

	async sendSmsFromBackend({
		to,
		sessionId = "system",
		text = "HELP",
		payload = {},
	}) {
		const frames = this.encodeAppMessage({ sessionId, text, payload });

		if (!this.session) {
			// in simple mode, print frames instead of sending to telecom
			console.log("[bridge] no SMPP session, outbound frames:");
			for (const frame of frames) {
				console.log(frame);
			}
			return;
		}

		for (const frame of frames) {
			await new Promise((resolve, reject) => {
				this.session.submit_sm(
					{
						source_addr: this.config.sourceAddr,
						destination_addr: to,
						short_message: frame,
						data_coding: 0,
					},
					(pdu) => {
						if (pdu.command_status === 0) {
							resolve();
							return;
						}
						reject(new Error(`submit_sm failed ${pdu.command_status}`));
					},
				);
			});
		}
	}
}

export function startMockSmscServer() {
	console.log("[mock-smsc] simple mock mode only (no telecom server started)");
}

export async function mockInjectInboundSms(
	bridge,
	{
		from = "639171234567",
		to = "2929",
		sessionId = "demo-session-1",
		text = "14.577,120.99|7E",
		payload = {},
	} = {},
) {
	const frames = bridge.encodeAppMessage({ sessionId, text, payload });
	for (const frame of frames) {
		await bridge.handleIncomingText({ from, to, text: frame });
	}
}
