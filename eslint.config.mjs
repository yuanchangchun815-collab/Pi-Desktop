import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
	{
		ignores: ["dist/", "release/", "node_modules/", "test/", "scripts/build-icons/", "demo/"],
	},
	...tseslint.configs.recommended,
	prettier,
	{
		files: ["electron/**/*.ts", "renderer/**/*.ts", "scripts/**/*.mjs"],
		rules: {
			// Project style: double quotes + semicolons are handled by Prettier,
			// so we only add non-style correctness rules here.
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
);
