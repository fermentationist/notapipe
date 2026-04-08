// import sveltePreprocess from "svelte-preprocess";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  // preprocess: sveltePreprocess(),
  preprocess: vitePreprocess(),
};
