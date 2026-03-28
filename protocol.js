export class SimpleSmsProtocol {
	constructor() {
		this.messages = [];
	}

	getById(id) {
		return this.messages.find((m) => m.id === id);
	}

	makeId() {
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		let id = "";
		for (let i = 0; i < 4; i += 1) {
			id += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return id;
	}

	parseHeader(frame) {
		const raw = frame.slice(0, 10);
		const part = Number(raw.slice(0, 3));
		const total = Number(raw.slice(3, 6));
		const id = raw.slice(6, 10);
		return { part, total, id };
	}

	parseData(rawData) {
		const out = {};
		const pairs = rawData.split("|");
		for (const pair of pairs) {
			const [key, ...rest] = pair.split("=");
			if (!key) {
				continue;
			}
			out[key] = rest.join("=");
		}
		return out;
	}

	decode(frame) {
		if (!frame || frame.length > 160) {
			throw new Error("Invalid SMS frame");
		}

		const header = this.parseHeader(frame);
		let msg = this.getById(header.id);

		if (!msg) {
			msg = { id: header.id, total: header.total, raw: [] };
			this.messages.push(msg);
		}

		msg.raw.push(frame);

		if (msg.raw.length < msg.total) {
			return {
				done: false,
				id: msg.id,
				part: msg.raw.length,
				total: msg.total,
			};
		}

		msg.raw.sort((a, b) => this.parseHeader(a).part - this.parseHeader(b).part);
		const joined = msg.raw.map((x) => x.slice(10)).join("");
		const data = this.parseData(joined);
		this.messages = this.messages.filter((x) => x.id !== msg.id);

		return { done: true, id: msg.id, data };
	}

	encode(data = {}, id = this.makeId()) {
		const body = Object.keys(data)
			.map((k) => `${k}=${data[k]}`)
			.join("|");

		const chunkSize = 150;
		const parts = [];
		for (let i = 0; i < body.length; i += chunkSize) {
			parts.push(body.slice(i, i + chunkSize));
		}

		if (parts.length === 0) {
			parts.push("");
		}

		return parts.map((chunk, index) => {
			const part = String(index + 1).padStart(3, "0");
			const total = String(parts.length).padStart(3, "0");
			return `${part}${total}${id}${chunk}`;
		});
	}
}
