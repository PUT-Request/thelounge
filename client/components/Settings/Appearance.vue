<template>
	<div>
		<SettingCard title="Theme">
			<label for="theme-select" class="sr-only">Theme</label>
			<select
				id="theme-select"
				:value="store.state.settings.theme"
				name="theme"
				class="input"
			>
				<option
					v-for="theme in store.state.serverConfiguration?.themes"
					:key="theme.name"
					:value="theme.name"
				>
					{{ theme.displayName }}
				</option>
			</select>
		</SettingCard>

		<SettingCard title="Messages">
			<SettingToggle
				name="motd"
				label="Show MOTD"
				description="Display the server's Message of the Day when connecting"
				:checked="store.state.settings.motd"
			/>
			<SettingToggle
				name="showSeconds"
				label="Include seconds in timestamps"
				description="Show seconds alongside hours and minutes in message timestamps"
				:checked="store.state.settings.showSeconds"
			/>
			<SettingToggle
				name="use12hClock"
				label="Use 12-hour clock"
				description="Display timestamps in 12-hour format instead of 24-hour"
				:checked="store.state.settings.use12hClock"
			/>
			<SettingToggle
				name="enableQuoteReply"
				label="Quote reply button"
				description="Show an extra button on messages that pastes a styled quote into the input (works on any network)"
				:checked="store.state.settings.enableQuoteReply"
			/>
		</SettingCard>

		<SettingCard v-if="store.state.serverConfiguration?.prefetch" title="Link previews">
			<SettingToggle
				name="media"
				label="Auto-expand media"
				description="Automatically show inline previews for images and videos"
				:checked="store.state.settings.media"
			/>
			<SettingToggle
				name="links"
				label="Auto-expand websites"
				description="Automatically show link previews for URLs"
				:checked="store.state.settings.links"
			/>
		</SettingCard>

		<SettingCard title="Status messages">
			<div class="setting-card-intro">
				Control how joins, parts, quits, kicks, nick changes, and mode changes appear
			</div>
			<div class="setting-radio-pills" role="group" aria-label="Status messages">
				<label class="setting-radio-pill">
					<input
						:checked="store.state.settings.statusMessages === 'shown'"
						type="radio"
						name="statusMessages"
						value="shown"
					/>
					<span class="pill-label">Show</span>
				</label>
				<label class="setting-radio-pill">
					<input
						:checked="store.state.settings.statusMessages === 'condensed'"
						type="radio"
						name="statusMessages"
						value="condensed"
					/>
					<span class="pill-label">Condense</span>
				</label>
				<label class="setting-radio-pill">
					<input
						:checked="store.state.settings.statusMessages === 'hidden'"
						type="radio"
						name="statusMessages"
						value="hidden"
					/>
					<span class="pill-label">Hide</span>
				</label>
			</div>
		</SettingCard>

		<SettingCard title="Visual aids">
			<SettingToggle
				name="coloredNicks"
				label="Colored nicknames"
				description="Assign a unique color to each nickname in chat"
				:checked="store.state.settings.coloredNicks"
			/>
			<SettingToggle
				name="statusIndicators"
				label="Online status indicators"
				description="Show a dot for whether the person in a query window is online or away"
				:checked="store.state.settings.statusIndicators"
			/>
			<SettingToggle
				name="autocomplete"
				label="Autocomplete"
				description="Suggest nicknames, channels, and commands as you type"
				:checked="store.state.settings.autocomplete"
			/>
			<label for="nickPostfix" class="setting-row-text">
				<div class="setting-row-label">Nick autocomplete postfix</div>
				<div class="setting-row-description">
					Character added after a completed nickname (e.g. a comma)
				</div>
			</label>
			<input
				id="nickPostfix"
				:value="store.state.settings.nickPostfix"
				type="text"
				name="nickPostfix"
				class="input"
				placeholder="e.g. , "
			/>
		</SettingCard>

		<SettingCard title="Bridged messages">
			<SettingToggle
				name="beautifyBridgedMessages"
				label="Beautify bridged shoutbox messages"
				description="Parse bot-bridged tracker messages into real nicknames"
				:checked="store.state.settings.beautifyBridgedMessages"
			/>
			<SettingToggle
				name="beautifyBbcodeMessages"
				label="Beautify BBCode messages"
				description="Render BBCode tags (quote, spoiler, note, alert) as rich content"
				:checked="store.state.settings.beautifyBbcodeMessages"
			/>
			<SettingToggle
				name="filterdmsEnabled"
				label="Enable DM filtering"
				description="Show a filter input in the direct messages section"
				:checked="store.state.settings.filterdmsEnabled"
			/>
			<SettingToggle
				name="showAllDMs"
				label="Show all DMs"
				description="List all direct message windows instead of the 5 most recent"
				:checked="store.state.settings.showAllDMs"
			/>
			<SettingToggle
				name="enhancedUserListEnabled"
				label="Enhanced user list"
				description="Use grouped user list when the server provides user groups"
				:checked="store.state.settings.enhancedUserListEnabled"
			/>
			<SettingToggle
				name="enhancedContextMenuEnabled"
				label="Enhanced context menu"
				description="Show extra actions (tracker profile, pin, user info) in context menus"
				:checked="store.state.settings.enhancedContextMenuEnabled"
			/>
			<SettingToggle
				name="showUserIdentity"
				label="Show account and host in user menu"
				description="Display the tracked services account and user@host under the nickname"
				:checked="store.state.settings.showUserIdentity"
			/>
			<SettingToggle
				name="enableRainbowHotkey"
				label="Rainbow hotkey"
				description="Enable Ctrl/Cmd+R shortcut for /rainbow text formatting"
				:checked="store.state.settings.enableRainbowHotkey"
			/>
		</SettingCard>

		<SettingCard title="Custom stylesheet">
			<div class="setting-card-intro">Override any style with your own CSS</div>
			<label for="user-specified-css-input" class="sr-only"> Custom stylesheet </label>
			<textarea
				id="user-specified-css-input"
				:value="store.state.settings.userStyles"
				class="input"
				name="userStyles"
				placeholder="/* Add your custom CSS here */"
			/>
		</SettingCard>
	</div>
</template>

<style>
textarea#user-specified-css-input {
	height: 100px;
}
</style>

<script lang="ts">
import {defineComponent} from "vue";
import {useStore} from "../../js/store";
import SettingCard from "./SettingCard.vue";
import SettingToggle from "./SettingToggle.vue";

export default defineComponent({
	name: "AppearanceSettings",
	components: {
		SettingCard,
		SettingToggle,
	},
	setup() {
		const store = useStore();

		return {
			store,
		};
	},
});
</script>
