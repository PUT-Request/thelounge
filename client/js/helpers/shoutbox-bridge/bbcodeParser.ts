import {h as createElement, type VNode} from "vue";
import parse from "../parse";
import type {ClientMessage, ClientNetwork} from "../../types";

type BbcodeNode = {
	tag: string;
	attr?: string;
	children: BbcodeChild[];
};

type BbcodeChild = BbcodeNode | string;

const supportedTags = new Set([
	"b",
	"i",
	"u",
	"s",
	"code",
	"color",
	"size",
	"font",
	"left",
	"center",
	"right",
	"quote",
	"spoiler",
	"note",
	"alert",
	"table",
	"tr",
	"td",
	"list",
	"url",
	"img",
	"video",
	"li",
]);

const tagRegex = /\[(\/)?([a-z*]+)(?:=([^\]]+))?\]/gi;

function appendText(node: BbcodeNode, text: string) {
	if (text) {
		node.children.push(text);
	}
}

function findLastTagIndex(stack: BbcodeNode[], tagName: string) {
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		if (stack[index].tag === tagName) {
			return index;
		}
	}

	return -1;
}

function parseBbcode(text: string) {
	const root: BbcodeNode = {tag: "root", children: []};
	const stack = [root];
	let lastIndex = 0;

	for (const match of text.matchAll(tagRegex)) {
		const [fullMatch, isClosing, rawTag, rawAttr] = match;
		const current = stack[stack.length - 1];

		appendText(current, text.slice(lastIndex, match.index));
		lastIndex = match.index + fullMatch.length;

		const tag = rawTag.toLowerCase();

		if (isClosing) {
			if (tag === "list" && stack[stack.length - 1].tag === "li") {
				stack.pop();
			}

			if (stack[stack.length - 1].tag === tag) {
				stack.pop();
			} else {
				appendText(current, fullMatch);
			}

			continue;
		}

		if (tag === "*") {
			const listIndex = findLastTagIndex(stack, "list");

			if (listIndex === -1) {
				appendText(current, fullMatch);
				continue;
			}

			while (stack.length - 1 > listIndex && stack[stack.length - 1].tag !== "li") {
				stack.pop();
			}

			if (stack[stack.length - 1].tag === "li") {
				stack.pop();
			}

			const list = stack[listIndex];
			const item: BbcodeNode = {tag: "li", children: []};
			list.children.push(item);
			stack.push(item);
			continue;
		}

		if (!supportedTags.has(tag)) {
			appendText(current, fullMatch);
			continue;
		}

		if (tag === "list") {
			const listNode: BbcodeNode = {tag, attr: rawAttr, children: []};
			current.children.push(listNode);
			stack.push(listNode);
			continue;
		}

		const node: BbcodeNode = {tag, attr: rawAttr, children: []};
		current.children.push(node);
		stack.push(node);
	}

	appendText(stack[stack.length - 1], text.slice(lastIndex));

	return root.children;
}

function collectText(nodes: BbcodeChild[]): string {
	return nodes
		.map((node) => {
			if (typeof node === "string") {
				return node;
			}

			return collectText(node.children);
		})
		.join("");
}

function flatten(
	nodes: Array<VNode | string | Array<VNode | string> | undefined>
): Array<VNode | string> {
	const out: Array<VNode | string> = [];

	for (const node of nodes) {
		if (node === undefined) {
			continue;
		}

		if (Array.isArray(node)) {
			out.push(...flatten(node));
		} else {
			out.push(node);
		}
	}

	return out;
}

function renderChildren(
	nodes: BbcodeChild[],
	message?: ClientMessage,
	network?: ClientNetwork
): Array<VNode | string> {
	return nodes.flatMap((node) => renderNode(node, message, network));
}

function renderNode(
	node: BbcodeChild,
	message?: ClientMessage,
	network?: ClientNetwork
): Array<VNode | string> {
	if (typeof node === "string") {
		const parsed = parse(node, message, network) as unknown as Array<
			VNode | string | Array<VNode | string> | undefined
		>;

		return flatten(parsed);
	}

	const children = renderChildren(node.children, message, network);

	switch (node.tag) {
		case "root":
			return children;
		case "b":
			return [createElement("span", {class: ["irc-bold"]}, children)];
		case "i":
			return [createElement("span", {class: ["irc-italic"]}, children)];
		case "u":
			return [createElement("span", {class: ["irc-underline"]}, children)];
		case "s":
			return [createElement("span", {class: ["irc-strikethrough"]}, children)];
		case "code":
			return [createElement("span", {class: ["irc-monospace"]}, collectText(node.children))];
		case "color":
			return [
				createElement(
					"span",
					{
						style: node.attr ? {color: node.attr} : undefined,
					},
					children
				),
			];
		case "size":
			return [
				createElement(
					"span",
					{
						style: node.attr ? {fontSize: node.attr + "px"} : undefined,
					},
					children
				),
			];
		case "font":
			return [
				createElement(
					"span",
					{
						style: node.attr ? {fontFamily: node.attr} : undefined,
					},
					children
				),
			];
		case "left":
		case "center":
		case "right":
			return [
				createElement(
					"div",
					{
						style: {textAlign: node.tag},
					},
					children
				),
			];

		case "quote": {
			const quoteHeader = node.attr
				? [
						createElement("cite", {class: ["bbcode-cite"]}, [
							createElement("i", {class: ["fas", "fa-quote-left"]}),
							`Quoting ${node.attr}:`,
						]),
					]
				: [];

			return [
				createElement("blockquote", {class: ["bbcode-quote"]}, [
					...quoteHeader,
					...children,
				]),
			];
		}

		case "spoiler":
			return [
				createElement("details", {class: ["bbcode-spoiler"]}, [
					createElement("summary", {class: ["bbcode-spoiler-header"]}, [
						`${node.attr ?? "Spoiler"}`,
					]),
					createElement("div", {class: ["bbcode-spoiler-content"]}, children),
				]),
			];
		case "note":
		case "alert":
			return [createElement("div", {class: [`bbcode-${node.tag}`]}, children)];
		case "table":
			return [createElement("table", {class: ["bbcode-table"]}, children)];
		case "tr":
			return [createElement("tr", undefined, children)];
		case "td":
			return [createElement("td", undefined, children)];

		case "list": {
			const ordered = node.attr && /^\d+$/.test(node.attr);
			return [createElement(ordered ? "ol" : "ul", {class: ["bbcode-list"]}, children)];
		}

		case "li":
			return [createElement("li", undefined, children)];

		case "url": {
			const href = node.attr || collectText(node.children);
			return [
				createElement(
					"a",
					{
						href,
						dir: "auto",
						target: "_blank",
						rel: "noopener",
					},
					children
				),
			];
		}

		case "img":
		case "video":
			return children;
		default:
			return children;
	}
}

export default function bbcodeParser(
	text: string,
	message?: ClientMessage,
	network?: ClientNetwork
) {
	return flatten(renderChildren(parseBbcode(text), message, network));
}
