import {promises as dns} from "dns";
import net from "net";

export type ResolvedAddress = {address: string; family: number};

const blockedAddresses = new net.BlockList();

for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
	["2001:db8::", 32],
] as const) {
	blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicNetworkAddress(address: string, family: number): boolean {
	if (family === 6 && address.toLowerCase().startsWith("::ffff:")) {
		return false;
	}

	return !blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

export async function resolvePublicHostname(hostname: string): Promise<ResolvedAddress[]> {
	const normalizedHostname = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

	if (normalizedHostname.toLowerCase() === "localhost") {
		throw new Error("Private network destinations are not allowed");
	}

	const addresses = await dns.lookup(normalizedHostname, {all: true, verbatim: true});

	if (
		addresses.length === 0 ||
		!addresses.every(({address, family}) => isPublicNetworkAddress(address, family))
	) {
		throw new Error("Private network destinations are not allowed");
	}

	return addresses;
}
