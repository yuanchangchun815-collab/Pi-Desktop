// Headless smoke test for the pi SDK integration used by the desktop app.
// Run with: node scripts/smoke-pi.mjs
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();

// Get available models so we pick one that has auth configured.
const available = await modelRuntime.getAvailable();
console.log("Available models:", available.slice(0, 5).map((m) => m.id));

if (available.length === 0) {
	console.log("No authenticated models found. Configure a provider first (e.g. ANTHROPIC_API_KEY).");
	console.log("Skipping live prompt test. This only validates SDK boot.");
	const { session } = await createAgentSession({
		modelRuntime,
		sessionManager: SessionManager.inMemory(process.cwd()),
	});
	session.dispose();
	console.log("SDK boot OK (no model).");
	process.exit(0);
}

const { session } = await createAgentSession({
	model: available[0],
	thinkingLevel: "off",
	modelRuntime,
	sessionManager: SessionManager.inMemory(process.cwd()),
});

let text = "";
session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
		text += event.assistantMessageEvent.delta;
	}
});

console.log("--- Prompting pi ---");
await session.prompt("Reply with exactly the two words: hello pi");
console.log("\n--- Result ---");
console.log(text.trim());
session.dispose();
process.exit(0);
