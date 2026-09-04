// https://vuejs.github.io/vetur/guide/setup.html#vue3
declare module "*.vue" {
	import type {DefineComponent} from "vue";
	// {} is intentional here (matches Vue's official shim): every SFC must
	// be assignable to this declaration.
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	const component: DefineComponent<{}, {}, any>;
	export default component;
}
