// ESLint 9 flat config. Mirrors the old .eslintrc.cjs rule sets:
// base rules everywhere, TypeScript rules (with type checking) on TS/Vue,
// vue3-recommended on SFCs, relaxed rules for tests, prettier last.
//
// Note on the typescript-eslint presets: the v8 flat entries are arrays
// with mixed file scoping, so they cannot be spread as objects. Instead
// their rule maps are merged here and scoped explicitly per block below,
// which is exactly what the old overrides did.
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import vueParser from "vue-eslint-parser";
import vuePlugin from "eslint-plugin-vue";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

function flatRules(name) {
	const entry = tsPlugin.configs[name];

	if (Array.isArray(entry)) {
		return Object.assign({}, ...entry.filter((e) => e.rules).map((e) => e.rules));
	}

	return {...entry.rules};
}

const tsRecommendedTypeCheckedRules = flatRules("flat/recommended-type-checked");

const projects = [
	"./tsconfig.json",
	"./client/tsconfig.json",
	"./server/tsconfig.json",
	"./shared/tsconfig.json",
	"./test/tsconfig.json",
];

const baseRules = {
	"block-scoped-var": "error",
	curly: ["error", "all"],
	"dot-notation": "error",
	eqeqeq: "error",
	"handle-callback-err": "error",
	"no-alert": "error",
	"no-catch-shadow": "error",
	"no-control-regex": "off",
	"no-console": "error",
	"no-duplicate-imports": "error",
	"no-else-return": "error",
	"no-implicit-globals": "error",
	"no-restricted-globals": ["error", "event", "fdescribe"],
	"no-template-curly-in-string": "error",
	"no-unsafe-negation": "error",
	"no-useless-computed-key": "error",
	"no-useless-constructor": "error",
	"no-useless-return": "error",
	"no-use-before-define": [
		"error",
		{
			functions: false,
		},
	],
	"no-var": "error",
	"object-shorthand": [
		"error",
		"methods",
		{
			avoidExplicitReturnArrows: true,
		},
	],
	"padding-line-between-statements": [
		"error",
		{
			blankLine: "always",
			prev: ["block", "block-like"],
			next: "*",
		},
		{
			blankLine: "always",
			prev: "*",
			next: ["block", "block-like"],
		},
	],
	"prefer-const": "error",
	"prefer-rest-params": "error",
	"prefer-spread": "error",
	"spaced-comment": ["error", "always"],
	yoda: "error",
};

const vueRules = {
	"import/no-default-export": 0,
	"import/unambiguous": 0, // vue SFC can miss script tags
	"@typescript-eslint/prefer-readonly": 0, // can be used in template
	"vue/component-tags-order": [
		"error",
		{
			order: ["template", "style", "script"],
		},
	],
	"vue/multi-word-component-names": "off",
	"vue/no-mutating-props": "off",
	"vue/no-v-html": "off",
	"vue/require-default-prop": "off",
	"vue/v-slot-style": ["error", "longform"],
};

const tsRules = {
	// note you must disable the base rule as it can report incorrect errors
	"no-shadow": "off",
	"@typescript-eslint/no-shadow": ["error"],
	"@typescript-eslint/no-redundant-type-constituents": "off",
	// `cond && action()` / `cond ? a : b` are an established idiom in
	// this codebase; v8 flags them by default, so allow the short-circuit
	// and ternary forms explicitly instead of churning every call site.
	"@typescript-eslint/no-unused-expressions": [
		"error",
		{
			allowShortCircuit: true,
			allowTernary: true,
		},
	],
};

const tsRulesTemp = {
	// TODO: eventually remove these
	"@typescript-eslint/ban-ts-comment": "off",
	"@typescript-eslint/no-explicit-any": "off",
	"@typescript-eslint/no-non-null-assertion": "off",
	"@typescript-eslint/no-this-alias": "off",
	"@typescript-eslint/no-unnecessary-type-assertion": "off",
	"@typescript-eslint/no-unsafe-argument": "off",
	"@typescript-eslint/no-unsafe-assignment": "off",
	"@typescript-eslint/no-unsafe-call": "off",
	"@typescript-eslint/no-unsafe-member-access": "off",
	"@typescript-eslint/no-unused-vars": "off",
};

const tsTestRulesTemp = {
	// TODO: remove these
	"@typescript-eslint/no-unsafe-return": "off",
	"@typescript-eslint/no-empty-function": "off",
	"@typescript-eslint/restrict-plus-operands": "off",
};

const tsParserOptions = {
	tsconfigRootDir: import.meta.dirname,
	project: projects,
	extraFileExtensions: [".vue"],
};

const allGlobals = {
	...globals.browser,
	...globals.node,
	...globals.mocha,
};

export default [
	{
		ignores: ["public/", "coverage/", "dist/", "vite.config.ts", "vitest.config.ts"],
	},
	js.configs.recommended,
	// Base-rule disables for files the TS rules cover. The preset entry
	// only targets *.ts, so .vue gets the same treatment explicitly below.
	tsPlugin.configs["flat/eslint-recommended"],
	{
		files: ["**/*.ts", "**/*.vue"],
		languageOptions: {
			ecmaVersion: 2022,
			parser: tsParser,
			parserOptions: tsParserOptions,
			globals: allGlobals,
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsRecommendedTypeCheckedRules,
			...baseRules,
			...tsRules,
			...tsRulesTemp,
		},
	},
	...vuePlugin.configs["flat/recommended"],
	{
		files: ["**/*.vue"],
		languageOptions: {
			ecmaVersion: 2022,
			parser: vueParser,
			parserOptions: {
				ecmaVersion: 2022,
				ecmaFeatures: {
					jsx: true,
				},
				parser: tsParser,
				...tsParserOptions,
			},
			globals: allGlobals,
		},
		plugins: {
			vue: vuePlugin,
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsRecommendedTypeCheckedRules,
			...baseRules,
			...tsRules,
			...tsRulesTemp,
			...vueRules,
			// Base-rule disables for .vue script blocks (see above).
			...tsPlugin.configs["flat/eslint-recommended"].rules,
		},
	},
	{
		files: ["./test/**/*.ts"],
		languageOptions: {
			ecmaVersion: 2022,
			parser: tsParser,
			parserOptions: tsParserOptions,
			globals: allGlobals,
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsRecommendedTypeCheckedRules,
			...baseRules,
			...tsRules,
			...tsRulesTemp,
			...tsTestRulesTemp,
			// Test files use chai property assertions (expect(x).to.be.true),
			// which read as unused member expressions - the rule stays on
			// for real source, where such an expression is a probable bug.
			"@typescript-eslint/no-unused-expressions": "off",
		},
	},
	{
		files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: allGlobals,
		},
		rules: baseRules,
	},
	eslintConfigPrettier,
];
