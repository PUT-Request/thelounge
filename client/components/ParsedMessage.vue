<script lang="ts">
import {defineComponent, PropType, h} from "vue";
import parse from "../js/helpers/parse";
import bbcodeParse from "../js/helpers/shoutbox-bridge/bbcodeParser";
import type {ClientMessage, ClientNetwork} from "../js/types";

export default defineComponent({
	name: "ParsedMessage",
	functional: true,
	props: {
		text: String,
		message: {type: Object as PropType<ClientMessage | string>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: false},
	},
	render(context) {
		if (typeof context.message !== "string" && context.message?.bbcodeBeautified) {
			return bbcodeParse(
				typeof context.text !== "undefined" ? context.text : context.message.text,
				context.message,
				context.network
			);
		}

		return parse(
			typeof context.text !== "undefined" ? context.text : context.message.text,
			context.message,
			context.network
		);
	},
});
</script>
