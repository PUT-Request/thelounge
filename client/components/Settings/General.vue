<template>
	<div>
		<!-- Native app -->
		<SettingCard v-if="canRegisterProtocol || hasInstallPromptEvent" title="Native app">
			<div v-if="hasInstallPromptEvent" class="setting-action-row">
				<div class="setting-card-intro">
					Install The Lounge as a standalone app on your device
				</div>
				<button type="button" class="btn btn-small" @click.prevent="nativeInstallPrompt">
					Add to Home screen
				</button>
			</div>
			<div v-if="canRegisterProtocol" class="setting-action-row">
				<div class="setting-card-intro">Handle irc:// links directly in The Lounge</div>
				<button type="button" class="btn btn-small" @click.prevent="registerProtocol">
					Register as irc:// handler
				</button>
			</div>
		</SettingCard>

		<!-- File uploads -->
		<SettingCard v-if="store.state.serverConfiguration?.fileUpload" title="File uploads">
			<SettingToggle
				name="uploadCanvas"
				label="Strip image metadata"
				description="Re-render images to remove EXIF data before uploading. May affect orientation in older browsers."
				:checked="store.state.settings.uploadCanvas"
			/>
			<template v-if="store.state.serverConfiguration?.allowFileUploadBackendSelection">
				<label for="uploadTo" class="setting-row-text">
					<div class="setting-row-label">Upload backend</div>
					<div class="setting-row-description">Service used to host uploaded files</div>
				</label>
				<select
					id="uploadTo"
					:value="store.state.settings.uploadTo"
					name="uploadTo"
					class="input"
				>
					<option
						v-for="provider in UploadProviders"
						:key="provider.id"
						:value="provider.id"
					>
						{{ provider.displayName }}
					</option>
				</select>
				<div v-if="currentUploadBackend?.supportNote" class="setting-row-description">
					<p v-for="note in currentUploadBackend?.supportNote?.split('\n')" :key="note">
						{{ note }}
					</p>
				</div>
				<div v-if="currentUploadBackend?.requiresURL">
					<label for="uploadURL" class="setting-row-text">
						<div class="setting-row-label">Upload API URL</div>
						<div class="setting-row-description">
							The URL to use to upload to the service
						</div>
					</label>
					<input
						id="uploadURL"
						:value="store.state.settings.uploadURL"
						autocomplete="off"
						type="text"
						name="uploadURL"
						class="input"
						placeholder="Enter api upload url"
					/>
				</div>
				<div v-if="currentUploadBackend?.requiresToken">
					<label for="uploadToken" class="setting-row-text">
						<div class="setting-row-label">Upload API key</div>
						<div class="setting-row-description">
							The API key used to authorize uploads to the selected service
						</div>
					</label>
					<div class="password-container">
						<RevealPassword v-slot:default="slotProps">
							<input
								id="uploadToken"
								:value="store.state.settings.uploadToken"
								autocomplete="off"
								:type="slotProps.isVisible ? 'text' : 'password'"
								name="uploadToken"
								class="input"
								placeholder="Enter api auth key"
							/>
						</RevealPassword>
					</div>
				</div>
				<div v-if="currentUploadBackend?.validTtl">
					<label for="uploadTTL" class="setting-row-text">
						<div class="setting-row-label">Upload retention</div>
						<div class="setting-row-description">
							How long the upload exists before it is removed
						</div>
					</label>
					<select
						id="uploadTTL"
						:value="store.state.settings.uploadTTL"
						name="uploadTTL"
						class="input"
					>
						<option
							v-for="ttl in currentUploadBackend.validTtl"
							:key="ttl.id"
							:value="ttl.id"
						>
							{{ ttl.displayName }}
						</option>
					</select>
					<div v-if="store.state.settings.uploadTTL === 'custom'">
						<label for="uploadTTLCustom" class="setting-row-text">
							<div class="setting-row-label">Custom retention (seconds)</div>
						</label>
						<input
							id="uploadTTLCustom"
							:value="store.state.settings.uploadTTLCustom"
							type="number"
							min="1"
							step="1"
							autocomplete="off"
							name="uploadTTLCustom"
							class="input"
							placeholder="e.g. 3600 for 1 hour"
						/>
					</div>
				</div>
			</template>
		</SettingCard>

		<!-- Settings sync -->
		<SettingCard v-if="!store.state.serverConfiguration?.public" title="Settings sync">
			<SettingToggle
				name="syncSettings"
				label="Sync settings across devices"
				description="Keep your preferences in sync with other browsers and devices"
				:checked="store.state.settings.syncSettings"
			/>
			<template v-if="!store.state.settings.syncSettings">
				<div v-if="store.state.serverHasSettings" class="setting-action-row">
					<div class="setting-card-intro">
						<strong>Warning:</strong> Enabling sync will override this client's settings
						with those stored on the server.
					</div>
					<button type="button" class="btn btn-small" @click="onForceSyncClick">
						Sync settings and enable
					</button>
				</div>
				<div v-else class="setting-card-intro">
					No settings have been synced before. Enabling this will upload your current
					settings as the starting point for other devices.
				</div>
			</template>
		</SettingCard>

		<!-- Performance -->
		<SettingCard title="Performance">
			<div>
				<label for="warmChannels" class="setting-row-text">
					<div class="setting-row-label">
						Recently viewed channels to keep loaded ({{
							store.state.settings.warmChannels
						}})
					</div>
					<div class="setting-row-description">
						Switching back to a recently viewed channel is instant while it stays
						loaded. Higher values use more memory; 0 always trims channels when
						switching away.
					</div>
				</label>
				<input
					id="warmChannels"
					:value="store.state.settings.warmChannels"
					type="range"
					name="warmChannels"
					class="input"
					min="0"
					max="20"
					step="1"
				/>
			</div>
		</SettingCard>

		<!-- Typing indicators -->
		<SettingCard title="Typing indicators">
			<div class="setting-card-intro">
				Show when others are typing, and let them see when you are
			</div>
			<label for="typing" class="sr-only">Typing indicators</label>
			<select id="typing" :value="store.state.settings.typing" name="typing" class="input">
				<option value="on">Send &amp; receive</option>
				<option value="receive">Receive only</option>
				<option value="off">Off</option>
			</select>
		</SettingCard>

		<!-- Away message -->
		<SettingCard v-if="!store.state.serverConfiguration?.public" title="Away message">
			<div>
				<label for="awayMessage" class="setting-row-text">
					<div class="setting-row-label">Away message</div>
					<div class="setting-row-description">
						Automatically set when The Lounge is not open
					</div>
				</label>
				<input
					id="awayMessage"
					:value="store.state.settings.awayMessage"
					type="text"
					name="awayMessage"
					class="input"
					placeholder="Away message"
				/>
			</div>
		</SettingCard>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, onMounted, onUpdated, ref} from "vue";
import {useStore} from "../../js/store";
import {BeforeInstallPromptEvent} from "../../js/types";
import {UploadProviders} from "../../../shared/upload-providers";
import SettingCard from "./SettingCard.vue";
import SettingToggle from "./SettingToggle.vue";
import RevealPassword from "../RevealPassword.vue";

let installPromptEvent: BeforeInstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	installPromptEvent = e as BeforeInstallPromptEvent;
});

export default defineComponent({
	name: "GeneralSettings",
	components: {
		SettingCard,
		SettingToggle,
		RevealPassword,
	},
	setup() {
		const store = useStore();
		const canRegisterProtocol = ref(false);

		const currentUploadBackend = computed(() => {
			return UploadProviders.find((b) => b.id === store.state.settings.uploadTo);
		});

		onUpdated(() => {
			if (
				!currentUploadBackend.value?.validTtl?.find(
					(ttl) => ttl.id === store.state.settings.uploadTTL
				)
			) {
				store.state.settings.uploadTTL =
					currentUploadBackend.value?.validTtl?.find((ttl) => ttl.default === true)?.id ??
					"";
			}
		});

		const hasInstallPromptEvent = computed(() => {
			// TODO: This doesn't hide the button after clicking
			return installPromptEvent !== null;
		});

		onMounted(() => {
			// Enable protocol handler registration if supported,
			// and the network configuration is not locked
			canRegisterProtocol.value =
				!!window.navigator.registerProtocolHandler &&
				!store.state.serverConfiguration?.lockNetwork;
		});

		const nativeInstallPrompt = () => {
			if (!installPromptEvent) {
				return;
			}

			installPromptEvent.prompt().catch((e) => {
				// eslint-disable-next-line no-console
				console.error(e);
			});

			installPromptEvent = null;
		};

		const onForceSyncClick = () => {
			store.dispatch("settings/syncAll", true).catch((e) => {
				// eslint-disable-next-line no-console
				console.error(e);
			});

			store
				.dispatch("settings/update", {
					name: "syncSettings",
					value: true,
					sync: true,
				})
				.catch((e) => {
					// eslint-disable-next-line no-console
					console.error(e);
				});
		};

		const registerProtocol = () => {
			const uri = document.location.origin + document.location.pathname + "?uri=%s";
			// @ts-expect-error
			// the third argument is deprecated but recommended for compatibility: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/registerProtocolHandler
			window.navigator.registerProtocolHandler("irc", uri, "The Lounge");
			// @ts-expect-error
			window.navigator.registerProtocolHandler("ircs", uri, "The Lounge");
		};

		return {
			store,
			canRegisterProtocol,
			hasInstallPromptEvent,
			nativeInstallPrompt,
			onForceSyncClick,
			registerProtocol,
			UploadProviders,
			currentUploadBackend,
		};
	},
});
</script>
