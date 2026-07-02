import type { CollectionEntry } from 'astro:content';

type BlogPost = CollectionEntry<'blog'>;

export const slugify = (input: string) => {
	if (!input) return '';

	// Normalize common tech punctuation so tags stay readable.
	let slug = input
		.normalize('NFKC')
		.toLowerCase()
		.trim()
		.replace(/\+/g, ' plus ')
		.replace(/#/g, ' sharp ')
		.replace(/&/g, ' and ');

	// Remove accents while keeping non-Latin scripts like Chinese intact.
	slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

	// Replace punctuation with spaces but keep unicode letters/numbers.
	slug = slug.replace(/[^\p{Letter}\p{Number}\s-]/gu, ' ').trim();

	// replace multiple spaces or hyphens with a single hyphen
	slug = slug.replace(/[\s-]+/g, '-');

	return slug;
};

export const unslugify = (slug: string) =>
	slug.replace(/\-/g, ' ').replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase());

export const assertUniqueTagSlugs = (pairs: Array<{ slug: string; label: string }>) => {
	const seen = new Map<string, string>();

	for (const { slug, label } of pairs) {
		if (!slug) continue;

		const existing = seen.get(slug);
		if (existing && existing !== label) {
			throw new Error(`Tag slug collision: "${existing}" and "${label}" both resolve to "${slug}".`);
		}

		seen.set(slug, label);
	}
};

export const sortBlogPostsByPubDate = <T extends BlogPost>(posts: T[]) =>
	posts.toSorted((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

export const getTagSlugPairs = (posts: BlogPost[]) =>
	posts.flatMap((post) =>
		post.data.tags.map((tag) => ({
			slug: slugify(tag),
			label: tag
		}))
	);

export const assertUniqueBlogTagSlugs = (posts: BlogPost[]) => {
	assertUniqueTagSlugs(getTagSlugPairs(posts));
};

export const kFormatter = (num: number) => {
	return Math.abs(num) > 999 ? (Math.sign(num) * (Math.abs(num) / 1000)).toFixed(1) + 'k' : Math.sign(num) * Math.abs(num);
};

export const getRepositoryDetails = async (repositoryFullname: string) => {
	const token = import.meta.env.GITHUB_PERSONAL_ACCESS_TOKEN;
	const headers: HeadersInit = {
		'X-GitHub-Api-Version': '2022-11-28'
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	const repoDetails = await fetch('https://api.github.com/repos/' + repositoryFullname, {
		method: 'GET',
		headers
	});
	const response = await repoDetails.json();
	return response;
};
