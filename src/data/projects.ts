export interface Project {
  name: string;
  demoLink: string;
  tags?: string[];
  description?: string;
  postLink?: string;
  demoLinkRel?: string;
  [key: string]: any;
}

export const projects: Project[] = [
  // {
  //   name: 'My Project',
  //   description: '一句话介绍这个项目解决了什么问题。',
  //   demoLink: 'https://example.com',
  //   demoLinkRel: 'nofollow noopener noreferrer',
  //   tags: ['Astro', 'TypeScript'],
  //   postLink: '/posts/my-project/'
  // }
];
