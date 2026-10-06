import { error } from '@sveltejs/kit';
import { PRODUCTS_API_URL } from '$app/env/private';
import { fetchProducts } from '#lib';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		return { products: await fetchProducts(fetch, PRODUCTS_API_URL) };
	} catch (e) {
		console.error(e);
		error(502, 'Could not load products');
	}
};
