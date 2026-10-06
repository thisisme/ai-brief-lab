export type Product = {
	id: number;
	name: string;
	price: number;
	description?: string;
};

function isProduct(value: unknown): value is Product {
	if (typeof value !== 'object' || value === null) return false;
	const p = value as Record<string, unknown>;
	return typeof p.id === 'number' && typeof p.name === 'string' && typeof p.price === 'number';
}

export async function fetchProducts(fetch: typeof globalThis.fetch, url: string): Promise<Product[]> {
	const res = await fetch(url, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`Products endpoint responded ${res.status}`);

	const body: unknown = await res.json();
	const list = Array.isArray(body) ? body : (body as { products?: unknown })?.products;
	if (!Array.isArray(list) || !list.every(isProduct)) {
		throw new Error('Products endpoint returned an unexpected shape');
	}
	return list;
}
