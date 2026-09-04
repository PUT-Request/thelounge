module.exports = {
	extends: "stylelint-config-standard",
	rules: {
		// indentation was removed from stylelint core (v16+); tabs remain
		// the convention via .editorconfig.
		"font-family-no-missing-generic-family-keyword": null,
		"no-descending-specificity": null,
		"at-rule-no-vendor-prefix": true,
		"media-feature-name-no-vendor-prefix": true,
		"property-no-vendor-prefix": true,
		"selector-no-vendor-prefix": true,
		"value-no-vendor-prefix": true,
		"selector-class-pattern": null,
		"selector-id-pattern": null,
	},
};
