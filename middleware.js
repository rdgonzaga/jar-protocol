import { SimpleSmsProtocol } from "./protocol.js";

export class SmppHttpBridge {
	constructor(config = {}) {
		this.config = {
			backendUrl: config.backendUrl || "http://127.0.0.1:3000/sms/inbound",
			smppHost: config.smppHost || "127.0.0.1",
			smppPort: Number(config.smppPort || 2775),
			systemId: config.systemId || "tsupersaver-esme",
			password: config.password || "password",
			sourceAddr: config.sourceAddr || "TsuperSaver",
		};

		this.protocol = new SimpleSmsProtocol();
		this.session = null;
		this.smpp = null;
	}

	async startSmpp() {
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

		const decoded = this.protocol.decode(text);
		if (!decoded.done) {
			console.log(
				`[bridge] waiting parts ${decoded.part}/${decoded.total} id=${decoded.id}`,
			);
			return;
		}

		const body = {
			channel: "sms",
			transport: "smpp",
			from,
			to,
			msgId: decoded.id,
			authToken: decoded.data.a || "",
			type: decoded.data.t || "",
			payload: this.tryParseJson(decoded.data.p || "{}"),
			receivedAt: new Date().toISOString(),
		};

		const response = await fetch(this.config.backendUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`backend HTTP ${response.status}`);
		}

		console.log(`[bridge] forwarded msgId=${body.msgId}`);
	}

	tryParseJson(raw) {
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	}

	encodeAppMessage({ authToken = "", type = "", payload = {} }) {
		return this.protocol.encode({
			a: authToken,
			t: type,
			p: JSON.stringify(payload),
		});
	}

	async sendSmsFromBackend({
		to,
		authToken = "system",
		type = "reply",
		payload = {},
	}) {
		const frames = this.encodeAppMessage({ authToken, type, payload });

		if (!this.session) {
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
		authToken = "drv-demo",
		type = "fuel.lookup",
		payload = { routeCode: "7E", currentLat: 14.5631, currentLng: 121.037 },
	} = {},
) {
	const frames = bridge.encodeAppMessage({ authToken, type, payload });
	for (const frame of frames) {
		await bridge.handleIncomingText({ from, to, text: frame });
	}
}
