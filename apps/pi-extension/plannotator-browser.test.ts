import { describe, expect, test } from "bun:test";
import {
	shouldUseLocalPrCheckout,
	startBrowserDecisionSession,
	stopAllBrowserDecisionSessions,
} from "./plannotator-browser.ts";

describe("shouldUseLocalPrCheckout", () => {
	test("uses local PR checkout by default", () => {
		expect(shouldUseLocalPrCheckout({})).toBe(true);
		expect(shouldUseLocalPrCheckout({ useLocal: true })).toBe(true);
	});

	test("honors the Pi --no-local opt-out", () => {
		expect(shouldUseLocalPrCheckout({ useLocal: false })).toBe(false);
	});
});

describe("browser session cleanup", () => {
	const ctx = {
		hasUI: true,
		ui: {
			notify() {},
			theme: { fg: () => "" },
			setStatus() {},
		},
	} as any;

	test("positive: host shutdown stops every active browser session and rejects its pending decision", async () => {
		const stopCounts = [0, 0];
		const never = new Promise<never>(() => {});
		const sessions = stopCounts.map((_, index) =>
			startBrowserDecisionSession(
				{ url: `http://localhost:${index + 1}`, stop: () => stopCounts[index]++ },
				ctx,
				() => never,
			),
		);
		const decisions = sessions.map((session) => session.waitForDecision().catch((error) => error));

		stopAllBrowserDecisionSessions();

		expect(stopCounts).toEqual([1, 1]);
		for (const decision of decisions) {
			const error = await decision;
			expect(error).toBeInstanceOf(Error);
			expect(error.message).toBe("Plannotator browser session was stopped.");
		}
	});

	test("positive: tool cancellation stops its browser session immediately", async () => {
		let stops = 0;
		const controller = new AbortController();
		const session = startBrowserDecisionSession(
			{ url: "http://localhost:1", stop: () => stops++ },
			ctx,
			() => new Promise<never>(() => {}),
			controller.signal,
		);
		const decision = session.waitForDecision().catch((error) => error);

		controller.abort();

		expect(stops).toBe(1);
		expect((await decision).message).toBe("Plannotator browser session was stopped.");
	});

	test("negative: an already-aborted tool never leaves an active browser session", async () => {
		let stops = 0;
		const controller = new AbortController();
		controller.abort();

		const session = startBrowserDecisionSession(
			{ url: "http://localhost:1", stop: () => stops++ },
			ctx,
			() => new Promise<never>(() => {}),
			controller.signal,
		);
		const decision = session.waitForDecision().catch((error) => error);
		stopAllBrowserDecisionSessions();

		expect(stops).toBe(1);
		expect((await decision).message).toBe("Plannotator browser session was stopped.");
	});

	test("negative: host shutdown does not stop an already-stopped session again", async () => {
		let stops = 0;
		const session = startBrowserDecisionSession(
			{ url: "http://localhost:1", stop: () => stops++ },
			ctx,
			() => new Promise<never>(() => {}),
		);
		const decision = session.waitForDecision().catch((error) => error);

		session.stop();
		stopAllBrowserDecisionSessions();
		stopAllBrowserDecisionSessions();

		expect(stops).toBe(1);
		expect((await decision).message).toBe("Plannotator browser session was stopped.");
	});

	test("negative: host shutdown is a no-op when no browser sessions are active", () => {
		expect(() => stopAllBrowserDecisionSessions()).not.toThrow();
		expect(() => stopAllBrowserDecisionSessions()).not.toThrow();
	});
});
