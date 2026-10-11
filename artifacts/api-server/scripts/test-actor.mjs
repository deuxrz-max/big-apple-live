import { createConnection } from "node:net";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const action = args.shift();
const values = {};
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (!key?.startsWith("--") || i + 1 >= args.length) {
    console.error("Use --as, --to, --room, --text and --gift options as shown in the usage.");
    process.exit(2);
  }
  values[key.slice(2)] = args[++i];
}

if (action === "cleanup" && process.env.NODE_ENV === "production") {
  console.error("Test-account cleanup is disabled in production.");
  process.exit(2);
}

const payloadByAction = {
  accounts: { action: "list" },
  cleanup: values.confirm
    ? { action: "cleanup-delete", confirmation: values.confirm }
    : { action: "cleanup-preview" },
  join: { action: "join", as: values.as, room: values.room },
  leave: { action: "leave", as: values.as, room: values.room },
  chat: { action: "chat", as: values.as, room: values.room, text: values.text },
  dm: { action: "dm", as: values.as, to: values.to, text: values.text },
  gift: { action: "gift", as: values.as, to: values.to, room: values.room, gift: values.gift },
};

if (!payloadByAction[action]) {
  console.error([
    "Test actor actions (development only):",
    "  pnpm --filter @workspace/api-server run test-actor -- accounts",
    "  pnpm --filter @workspace/api-server run test-actor -- cleanup",
    "  pnpm --filter @workspace/api-server run test-actor -- cleanup --confirm <confirmation-token>",
    "  pnpm --filter @workspace/api-server run test-actor -- join --as TestBigo1 --room \"LiveMe\"",
    "  pnpm --filter @workspace/api-server run test-actor -- leave --as TestBigo1 --room \"LiveMe\"",
    "  pnpm --filter @workspace/api-server run test-actor -- chat --as TestBigo1 --room \"LiveMe\" --text \"Hello from a test account\"",
    "  pnpm --filter @workspace/api-server run test-actor -- dm --as TestBigo1 --to Vampsquad --text \"Hello\"",
    "  pnpm --filter @workspace/api-server run test-actor -- gift --as TestBigo1 --to TestBigo2 --room \"LiveMe\" --gift moonfox",
  ].join("\n"));
  process.exit(action ? 2 : 0);
}

const port = process.env.PORT ?? "8080";
const socketPath = resolve(`/tmp/streamtalk-test-actors-${port}.sock`);
const socket = createConnection(socketPath);
let response = "";
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(`${JSON.stringify(payloadByAction[action])}\n`));
socket.on("data", chunk => { response += chunk; });
socket.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(response);
    console.log(JSON.stringify(parsed, null, 2));
    if (!parsed.ok) process.exitCode = 1;
  } catch {
    console.error("Test actor control returned an invalid response.");
    process.exitCode = 1;
  }
  if (parsed?.ok && action === "cleanup" && !values.confirm) {
    const result = parsed.result;
    if (result.deletable) {
      console.log(`To remove exactly these marked accounts, rerun with --confirm ${result.confirmation}`);
    } else {
      console.error("Cleanup is blocked to protect messages or relationships involving real accounts.");
      process.exitCode = 1;
    }
  }
});
socket.on("error", error => {
  console.error(error.code === "ENOENT"
    ? "Test actor control is unavailable. Start the development API Server workflow first."
    : "Could not reach the local development test actor control.");
  process.exitCode = 1;
});
