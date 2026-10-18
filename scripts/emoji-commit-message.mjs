import { readFileSync, writeFileSync } from "node:fs";

const emojiByType = {
	feat: ["✨", "🎉", "🎊", "🚀"],
	fix: ["🐛", "🚑", "🩹", "🐝"],
	docs: ["📚", "📖", "📝"],
	style: ["💎", "🎨"],
	refactor: ["📦", "🔨", "🔧"],
	perf: ["🚀", "🏎️", "🏍️", "🚄"],
	test: ["🚨", "🚧", "🚥", "🔍"],
	build: ["🏗️", "🧱", "🔨", "👷"],
	ci: ["🤖", "🔧", "🧪"],
	chore: ["🧹", "🧽", "🧼", "🧺"],
	revert: ["🔙", "⏪", "🔁"],
	release: ["🚀", "🎉", "🎊", "📦"],
	dependabot: ["🤖", "🔧", "🧪"],
	first: ["🎉", "🎊", "🎈", "🎂"],
};

const messagePath = process.argv[2];
if (!messagePath) {
	throw new Error("Usage: node scripts/emoji-commit-message.mjs <commit-message-file>");
}

const message = readFileSync(messagePath, "utf8");
if (/\p{Emoji_Presentation}/u.test(message)) {
	process.exit(0);
}

const newlineIndex = message.search(/\r?\n/);
const subject = newlineIndex === -1 ? message : message.slice(0, newlineIndex);
const typeMatch = /^([a-z]+)((?:\([^)\r\n]*\))?!?:?)[ \t]+(.*)$/i.exec(subject);
if (!typeMatch) {
	process.exit(0);
}

const emojis = emojiByType[typeMatch[1].toLowerCase()];
if (!emojis) {
	process.exit(0);
}

const emoji = emojis[Math.floor(Math.random() * emojis.length)];
const updatedSubject = `${typeMatch[1]}${typeMatch[2]} ${emoji} ${typeMatch[3]}`;
const updatedMessage = newlineIndex === -1 ? updatedSubject : `${updatedSubject}${message.slice(newlineIndex)}`;

writeFileSync(messagePath, updatedMessage);
