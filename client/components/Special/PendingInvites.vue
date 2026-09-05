<template>
	<div>
		<p v-if="invites.length === 0" class="invite-empty">No pending invitations.</p>
		<table v-else class="invite-list">
			<thead>
				<tr>
					<th class="channel">Channel</th>
					<th class="invited_by">Invited By</th>
					<th class="invited_at">Invited At</th>
					<th class="actions"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="invite in invites" :key="invite.channel.toLowerCase()">
					<td class="channel">{{ invite.channel }}</td>
					<td class="invited_by">{{ invite.from }}</td>
					<td class="invited_at">{{ localetime(invite.time) }}</td>
					<td class="actions">
						<button type="button" class="btn btn-small" @click="join(invite)">
							Join
						</button>
						<button type="button" class="btn btn-small" @click="dismiss(invite)">
							Dismiss
						</button>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import localetime from "../../js/helpers/localetime";
import socket from "../../js/socket";
import {ClientNetwork, ClientChan} from "../../js/types";

type PendingInvite = {
	channel: string;
	from: string;
	time: number;
};

export default defineComponent({
	name: "PendingInvites",
	props: {
		network: {type: Object as PropType<ClientNetwork>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
	},
	setup(props) {
		const invites = computed<PendingInvite[]>(
			() => (props.channel.data ?? []) as PendingInvite[]
		);

		const join = (invite: PendingInvite) => {
			socket.emit("input", {
				target: props.channel.id,
				text: `/join ${invite.channel}`,
			});
		};

		const dismiss = (invite: PendingInvite) => {
			socket.emit("invitations:dismiss", {
				target: props.channel.id,
				channel: invite.channel,
			});
		};

		return {
			invites,
			join,
			dismiss,
			localetime: (time: number): string => String(localetime(time)),
		};
	},
});
</script>
