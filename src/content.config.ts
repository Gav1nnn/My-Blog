import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders'; // Not available with legacy API

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: ({ image }) => z.object({
		title: z.string().min(1),
    seoTitle: z.string().min(1).optional(),
		description: z.string().min(1),
		// Transform string to Date object
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string().min(1)).default([]),
		coverImage: image().optional()
	})
});

export const collections = { blog };
