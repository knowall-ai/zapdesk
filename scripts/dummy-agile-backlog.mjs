/**
 * Backlog data for Corporate Marketing Website (Agile Template)
 *
 * Defines Epics, Features, User Stories, Tasks, and Bugs for demo project.
 * Uses the Agile process template hierarchy:
 *   Epic → Feature → User Story → Task/Bug
 *
 * Structure:
 * - Epic 1: Website Foundation & Customer Experience (COMPLETED)
 * - Epic 2: Services & Content Platform (COMPLETED)
 * - Epic 3: Marketing & Operations (COMPLETED)
 * - Epic 4: Website Support (ACTIVE - ongoing support)
 *
 * Note: All work items have GUIDs in their descriptions for upsert matching.
 * Items under "Website Support" are tagged with "ticket" as they represent
 * end-user support requests.
 */

// Helper to generate realistic support tickets
function generateSupportTickets(blockNum, count, state) {
  const ticketTemplates = [
    // Bugs
    {
      type: 'Bug',
      title: 'Homepage hero image not loading on Safari',
      desc: 'Users report hero images fail to load on Safari 17+',
      priority: 1,
    },
    {
      type: 'Bug',
      title: 'Contact form submission fails intermittently',
      desc: 'Form submissions return 500 error randomly (~5% of submissions)',
      priority: 1,
    },
    {
      type: 'Bug',
      title: 'Mobile menu animation stutters on iOS',
      desc: 'Hamburger menu animation is choppy on iPhone 14',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Footer links overlap on tablet portrait',
      desc: 'Footer navigation links overlap when viewport is 768-900px',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Newsletter signup throws validation error',
      desc: 'Valid emails rejected with "invalid email" message',
      priority: 1,
    },
    {
      type: 'Bug',
      title: 'Blog post images appear stretched',
      desc: 'Images in blog posts have incorrect aspect ratio on mobile',
      priority: 3,
    },
    {
      type: 'Bug',
      title: 'Search results not filtering correctly',
      desc: 'Category filter in search returns all results regardless of selection',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Page title missing on Services page',
      desc: 'Browser tab shows "undefined" instead of page title',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Social sharing buttons not working',
      desc: 'Share to LinkedIn/Twitter opens blank window',
      priority: 3,
    },
    {
      type: 'Bug',
      title: 'Cookie consent banner reappears after dismissal',
      desc: 'Cookie banner shows again on every page load despite accepting',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Careers page 404 error for job listings',
      desc: 'Individual job posting links return 404 Not Found',
      priority: 1,
    },
    {
      type: 'Bug',
      title: 'Video player controls hidden on dark backgrounds',
      desc: 'Play/pause controls invisible when video has dark thumbnail',
      priority: 3,
    },
    {
      type: 'Bug',
      title: 'Form date picker shows wrong timezone',
      desc: 'Date selection shows UTC instead of local timezone',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Broken breadcrumb navigation on deep pages',
      desc: 'Breadcrumbs show "undefined > undefined" on nested pages',
      priority: 2,
    },
    {
      type: 'Bug',
      title: 'Image gallery thumbnails not clickable',
      desc: 'Clicking thumbnail does not open full-size image',
      priority: 2,
    },
    // Tasks
    {
      type: 'Task',
      title: 'Update copyright year in footer',
      desc: 'Change copyright from 2024 to 2025 in site footer',
      priority: 3,
    },
    {
      type: 'Task',
      title: 'Add new team member to About page',
      desc: 'Add photo and bio for new Marketing Director',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Update pricing information',
      desc: 'Reflect new pricing structure on services page',
      priority: 1,
    },
    {
      type: 'Task',
      title: 'Replace placeholder images on homepage',
      desc: 'Upload final approved images from marketing team',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Update contact email addresses',
      desc: 'Change info@ to contact@ across all pages',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Add Google Analytics tracking',
      desc: 'Implement GA4 tracking with consent management',
      priority: 1,
    },
    {
      type: 'Task',
      title: 'Update privacy policy content',
      desc: 'Legal team provided new privacy policy text',
      priority: 1,
    },
    {
      type: 'Task',
      title: 'Add SSL certificate renewal reminder',
      desc: 'Set up monitoring for certificate expiration',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Optimize images for faster loading',
      desc: 'Compress and convert images to WebP format',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Add sitemap.xml for SEO',
      desc: 'Generate and submit XML sitemap to search engines',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Configure CDN caching rules',
      desc: 'Set appropriate cache headers for static assets',
      priority: 3,
    },
    {
      type: 'Task',
      title: 'Add structured data markup',
      desc: 'Implement JSON-LD for organization and breadcrumbs',
      priority: 3,
    },
    {
      type: 'Task',
      title: 'Update meta descriptions',
      desc: 'SEO team provided new meta descriptions for all pages',
      priority: 2,
    },
    {
      type: 'Task',
      title: 'Add 301 redirects for old URLs',
      desc: 'Redirect legacy page URLs to new structure',
      priority: 1,
    },
    {
      type: 'Task',
      title: 'Configure error pages (404, 500)',
      desc: 'Design and implement custom error pages',
      priority: 2,
    },
    // User Stories (for variety)
    {
      type: 'User Story',
      title: 'As a visitor, I want to download case studies',
      desc: 'Add PDF download functionality for case study pages',
      priority: 2,
      storyPoints: 3,
    },
    {
      type: 'User Story',
      title: 'As a user, I want to see related blog posts',
      desc: 'Show related articles at bottom of blog posts',
      priority: 3,
      storyPoints: 5,
    },
    {
      type: 'User Story',
      title: 'As a visitor, I want to filter services by category',
      desc: 'Add category filter to services listing page',
      priority: 2,
      storyPoints: 5,
    },
    {
      type: 'User Story',
      title: 'As a user, I want to subscribe to newsletter',
      desc: 'Newsletter signup with email validation and confirmation',
      priority: 2,
      storyPoints: 3,
    },
    {
      type: 'User Story',
      title: 'As a visitor, I want to contact specific departments',
      desc: 'Department selector on contact form with routing',
      priority: 2,
      storyPoints: 5,
    },
  ];

  const tickets = [];
  const usedIndices = new Set();

  for (let i = 0; i < count; i++) {
    // Pick a random template (allow repeats with suffix for variety)
    let idx = Math.floor(Math.random() * ticketTemplates.length);
    let suffix = '';
    if (usedIndices.has(idx)) {
      suffix = ` (${blockNum}-${i + 1})`;
    }
    usedIndices.add(idx);

    const template = ticketTemplates[idx];
    const ticket = {
      guid: `block${blockNum}-ticket-${i + 1}`,
      type: template.type,
      title: `${template.title}${suffix}`,
      description: `<p>${template.desc}</p><p>Reported by customer via support portal.</p>`,
      priority: template.priority,
      tags: ['ticket', 'support', `block-${blockNum}`],
      state: state,
    };

    if (template.remainingWork) {
      ticket.remainingWork = template.remainingWork;
    }
    if (template.storyPoints) {
      ticket.storyPoints = template.storyPoints;
    }

    tickets.push(ticket);
  }

  return tickets;
}

export const backlogData = [
  // ############################################################
  // EPIC 1: Website Foundation & Customer Experience (COMPLETED)
  // ############################################################
  {
    guid: 'epic-1-foundation',
    type: 'Epic',
    title: 'Website Foundation & Customer Experience',
    description: `
      <p>Establish the core technical foundation and primary customer-facing experience for the corporate marketing website.</p>
      <h3>Scope</h3>
      <ul>
        <li>Development environment and infrastructure setup</li>
        <li>Homepage and landing page experience</li>
        <li>Company information pages (About, Team, Careers)</li>
      </ul>
      <h3>Business Value</h3>
      <p>Creates the foundational platform and primary visitor experience that establishes brand credibility and drives initial engagement.</p>
    `,
    priority: 1,
    state: 'Active',
    tags: ['epic', 'foundation'],
    children: [
      // FEATURE 1: Website Foundation & Infrastructure
      {
        guid: 'feature-1-infrastructure',
        type: 'Feature',
        title: 'Website Foundation & Infrastructure',
        description: `
          <p>Establish the core technical foundation for the corporate marketing website.</p>
          <h3>Objectives</h3>
          <ul>
            <li>Set up modern development toolchain with TypeScript and Next.js</li>
            <li>Implement mobile-first responsive design system</li>
            <li>Configure production-ready hosting and CI/CD pipeline</li>
          </ul>
        `,
        priority: 1,
        state: 'Closed',
        tags: ['foundation', 'infrastructure'],
        children: [
          {
            guid: 'story-1-1-dev-env',
            type: 'User Story',
            title: 'Set up development environment and tooling',
            description:
              '<p>As a developer, I want a properly configured development environment so that I can build features efficiently with modern tooling.</p>',
            storyPoints: 5,
            priority: 1,
            state: 'Closed',
            tags: ['frontend', 'setup'],
            children: [
              {
                guid: 'task-1-1-1',
                type: 'Task',
                title: 'Configure Next.js project with TypeScript',
                description:
                  'Initialize Next.js 15 project with TypeScript, configure tsconfig.json.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-1-1-2',
                type: 'Task',
                title: 'Set up Tailwind CSS and design system',
                description: 'Install and configure Tailwind CSS, create custom design tokens.',
                remainingWork: 6,
                priority: 1,
                state: 'Closed',
                tags: ['frontend', 'design'],
              },
              {
                guid: 'task-1-1-3',
                type: 'Task',
                title: 'Configure ESLint and Prettier',
                description: 'Set up ESLint with TypeScript rules, configure Prettier.',
                remainingWork: 3,
                priority: 2,
                state: 'Closed',
                tags: ['tooling'],
              },
              {
                guid: 'task-1-1-4',
                type: 'Task',
                title: 'Set up GitHub repository and CI/CD pipeline',
                description: 'Create GitHub repo, configure GitHub Actions for CI.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['devops'],
              },
            ],
          },
          {
            guid: 'story-1-2-responsive',
            type: 'User Story',
            title: 'Implement responsive layout framework',
            description:
              '<p>As a user, I want the website to work perfectly on any device so that I have a consistent experience.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['frontend', 'responsive'],
            children: [
              {
                guid: 'task-1-2-1',
                type: 'Task',
                title: 'Create mobile-first grid system',
                description: 'Implement responsive grid using Tailwind CSS.',
                remainingWork: 6,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-1-2-2',
                type: 'Task',
                title: 'Build reusable header component',
                description: 'Create responsive header with navigation.',
                remainingWork: 8,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-1-2-3',
                type: 'Task',
                title: 'Build reusable footer component',
                description: 'Create responsive footer with links and contact info.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-1-2-4',
                type: 'Task',
                title: 'Implement navigation menu with mobile hamburger',
                description: 'Create mobile navigation with hamburger menu toggle.',
                remainingWork: 6,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-1-3-hosting',
            type: 'User Story',
            title: 'Configure hosting and deployment',
            description:
              '<p>As a developer, I want automated deployments so that changes go live quickly and reliably.</p>',
            storyPoints: 5,
            priority: 1,
            state: 'Closed',
            tags: ['devops', 'infrastructure'],
            children: [
              {
                guid: 'task-1-3-1',
                type: 'Task',
                title: 'Set up Azure App Service',
                description: 'Configure Azure App Service for Node.js hosting.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['devops', 'azure'],
              },
              {
                guid: 'task-1-3-2',
                type: 'Task',
                title: 'Configure custom domain and SSL',
                description: 'Set up custom domain with SSL certificate.',
                remainingWork: 3,
                priority: 1,
                state: 'Closed',
                tags: ['devops'],
              },
              {
                guid: 'task-1-3-3',
                type: 'Task',
                title: 'Set up production environment variables',
                description: 'Configure environment variables in Azure.',
                remainingWork: 2,
                priority: 2,
                state: 'Closed',
                tags: ['devops'],
              },
              {
                guid: 'bug-1-3-1',
                type: 'Bug',
                title: 'Fix SSL certificate renewal automation',
                description: 'SSL renewal failing due to DNS verification issue.',
                priority: 2,
                state: 'Closed',
                tags: ['devops', 'bug'],
              },
            ],
          },
        ],
      },
      // FEATURE 2: Homepage & Landing Experience
      {
        guid: 'feature-2-homepage',
        type: 'Feature',
        title: 'Homepage & Landing Experience',
        description:
          '<p>Create compelling homepage with hero section, value propositions, and CTAs.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['homepage', 'ux'],
        children: [
          {
            guid: 'story-2-1-hero',
            type: 'User Story',
            title: 'Design and implement hero section',
            description:
              '<p>As a visitor, I want to immediately understand the company value proposition.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['homepage', 'design'],
            children: [
              {
                guid: 'task-2-1-1',
                type: 'Task',
                title: 'Create hero section with animated background',
                description: 'Implement hero with gradient animation.',
                remainingWork: 8,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-2-1-2',
                type: 'Task',
                title: 'Implement headline and CTA buttons',
                description: 'Add compelling headline with primary/secondary CTAs.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-2-1-3',
                type: 'Task',
                title: 'Add responsive hero images',
                description: 'Implement responsive images with lazy loading.',
                remainingWork: 6,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-2-2-features',
            type: 'User Story',
            title: 'Build features showcase section',
            description: '<p>As a visitor, I want to see key features/services at a glance.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['homepage'],
            children: [
              {
                guid: 'task-2-2-1',
                type: 'Task',
                title: 'Create feature card component',
                description: 'Build reusable feature card with icon, title, description.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-2-2-2',
                type: 'Task',
                title: 'Implement features grid layout',
                description: 'Create responsive grid for feature cards.',
                remainingWork: 3,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-2-3-testimonials',
            type: 'User Story',
            title: 'Add testimonials carousel',
            description: '<p>As a visitor, I want to see social proof from existing customers.</p>',
            storyPoints: 5,
            priority: 3,
            state: 'Closed',
            tags: ['homepage', 'social-proof'],
            children: [
              {
                guid: 'task-2-3-1',
                type: 'Task',
                title: 'Build testimonial card component',
                description: 'Create testimonial card with quote, name, company.',
                remainingWork: 4,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-2-3-2',
                type: 'Task',
                title: 'Implement carousel with auto-rotation',
                description: 'Add carousel functionality with navigation dots.',
                remainingWork: 6,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
        ],
      },
      // FEATURE 3: About & Company Pages
      {
        guid: 'feature-3-about',
        type: 'Feature',
        title: 'About & Company Pages',
        description: '<p>Create company information pages including About, Team, and Careers.</p>',
        priority: 2,
        state: 'Closed',
        tags: ['about', 'company'],
        children: [
          {
            guid: 'story-3-1-about',
            type: 'User Story',
            title: 'Create About Us page',
            description:
              '<p>As a visitor, I want to learn about the company history and mission.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['about'],
            children: [
              {
                guid: 'task-3-1-1',
                type: 'Task',
                title: 'Design company story section',
                description: 'Create timeline/narrative of company history.',
                remainingWork: 6,
                priority: 2,
                state: 'Closed',
                tags: ['frontend', 'content'],
              },
              {
                guid: 'task-3-1-2',
                type: 'Task',
                title: 'Add mission and values section',
                description: 'Implement mission statement and core values.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend', 'content'],
              },
            ],
          },
          {
            guid: 'story-3-2-team',
            type: 'User Story',
            title: 'Build Team page with member profiles',
            description: '<p>As a visitor, I want to see who works at the company.</p>',
            storyPoints: 8,
            priority: 2,
            state: 'Closed',
            tags: ['team'],
            children: [
              {
                guid: 'task-3-2-1',
                type: 'Task',
                title: 'Create team member card component',
                description: 'Build card with photo, name, role, bio, social links.',
                remainingWork: 6,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-3-2-2',
                type: 'Task',
                title: 'Implement team grid with filtering',
                description: 'Create filterable grid by department.',
                remainingWork: 8,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-3-3-careers',
            type: 'User Story',
            title: 'Create Careers page with job listings',
            description: '<p>As a job seeker, I want to see open positions and apply.</p>',
            storyPoints: 8,
            priority: 3,
            state: 'Closed',
            tags: ['careers'],
            children: [
              {
                guid: 'task-3-3-1',
                type: 'Task',
                title: 'Build job listing component',
                description: 'Create job card with title, location, type, description.',
                remainingWork: 6,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-3-3-2',
                type: 'Task',
                title: 'Implement job application form',
                description: 'Create form with resume upload.',
                remainingWork: 8,
                priority: 3,
                state: 'Closed',
                tags: ['frontend', 'forms'],
              },
            ],
          },
        ],
      },
    ],
  },

  // ############################################################
  // EPIC 2: Services & Content Platform (COMPLETED)
  // ############################################################
  {
    guid: 'epic-2-services',
    type: 'Epic',
    title: 'Services & Content Platform',
    description: `
      <p>Build the services showcase and content platform for the marketing website.</p>
      <h3>Scope</h3>
      <ul>
        <li>Services pages with detailed information</li>
        <li>Blog/content management system</li>
        <li>Resource library and downloads</li>
      </ul>
    `,
    priority: 1,
    state: 'Active',
    tags: ['epic', 'services', 'content'],
    children: [
      // FEATURE 4: Services Pages
      {
        guid: 'feature-4-services',
        type: 'Feature',
        title: 'Services Pages',
        description: '<p>Create detailed services pages with pricing and features.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['services'],
        children: [
          {
            guid: 'story-4-1-listing',
            type: 'User Story',
            title: 'Create services listing page',
            description: '<p>As a visitor, I want to browse all available services.</p>',
            storyPoints: 5,
            priority: 1,
            state: 'Closed',
            tags: ['services'],
            children: [
              {
                guid: 'task-4-1-1',
                type: 'Task',
                title: 'Build service card component',
                description: 'Create card with icon, title, description, price.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-4-1-2',
                type: 'Task',
                title: 'Implement category filtering',
                description: 'Add filter by service category.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-4-2-detail',
            type: 'User Story',
            title: 'Build service detail pages',
            description: '<p>As a visitor, I want to see full details about each service.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['services'],
            children: [
              {
                guid: 'task-4-2-1',
                type: 'Task',
                title: 'Create service detail layout',
                description: 'Build responsive detail page template.',
                remainingWork: 6,
                priority: 1,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-4-2-2',
                type: 'Task',
                title: 'Add pricing comparison table',
                description: 'Create pricing tier comparison.',
                remainingWork: 6,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-4-2-3',
                type: 'Task',
                title: 'Implement FAQ accordion',
                description: 'Build expandable FAQ section.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
        ],
      },
      // FEATURE 5: Blog Platform
      {
        guid: 'feature-5-blog',
        type: 'Feature',
        title: 'Blog Platform',
        description: '<p>Build blog with categories, search, and rich content support.</p>',
        priority: 2,
        state: 'Closed',
        tags: ['blog', 'content'],
        children: [
          {
            guid: 'story-5-1-listing',
            type: 'User Story',
            title: 'Create blog listing page',
            description: '<p>As a reader, I want to browse all blog posts.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['blog'],
            children: [
              {
                guid: 'task-5-1-1',
                type: 'Task',
                title: 'Build blog post card component',
                description: 'Create card with image, title, excerpt, date.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-5-1-2',
                type: 'Task',
                title: 'Implement pagination',
                description: 'Add paginated post listing.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-5-1-3',
                type: 'Task',
                title: 'Add category filtering',
                description: 'Filter posts by category.',
                remainingWork: 3,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-5-2-post',
            type: 'User Story',
            title: 'Build blog post template',
            description: '<p>As a reader, I want a great reading experience.</p>',
            storyPoints: 8,
            priority: 2,
            state: 'Closed',
            tags: ['blog'],
            children: [
              {
                guid: 'task-5-2-1',
                type: 'Task',
                title: 'Create rich text renderer',
                description: 'Implement markdown/MDX rendering with syntax highlighting.',
                remainingWork: 8,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-5-2-2',
                type: 'Task',
                title: 'Add author bio section',
                description: 'Show author info at end of post.',
                remainingWork: 3,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-5-2-3',
                type: 'Task',
                title: 'Implement social sharing buttons',
                description: 'Add share to social media.',
                remainingWork: 4,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
        ],
      },
      // FEATURE 6: Resource Library
      {
        guid: 'feature-6-resources',
        type: 'Feature',
        title: 'Resource Library',
        description: '<p>Create downloadable resources section with whitepapers, case studies.</p>',
        priority: 2,
        state: 'Closed',
        tags: ['resources', 'downloads'],
        children: [
          {
            guid: 'story-6-1-library',
            type: 'User Story',
            title: 'Build resource library page',
            description: '<p>As a visitor, I want to find and download resources.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['resources'],
            children: [
              {
                guid: 'task-6-1-1',
                type: 'Task',
                title: 'Create resource card component',
                description: 'Build card with thumbnail, title, type, download.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-6-1-2',
                type: 'Task',
                title: 'Implement type filtering',
                description: 'Filter by resource type (whitepaper, case study, etc).',
                remainingWork: 3,
                priority: 3,
                state: 'Closed',
                tags: ['frontend'],
              },
            ],
          },
          {
            guid: 'story-6-2-gated',
            type: 'User Story',
            title: 'Create gated content form',
            description:
              '<p>As marketing, I want to collect leads before downloading resources.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['resources', 'lead-gen'],
            children: [
              {
                guid: 'task-6-2-1',
                type: 'Task',
                title: 'Build lead capture form',
                description: 'Create form with name, email, company fields.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend', 'forms'],
              },
              {
                guid: 'task-6-2-2',
                type: 'Task',
                title: 'Implement form validation and submission',
                description: 'Add validation and API integration.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend', 'api'],
              },
            ],
          },
        ],
      },
    ],
  },

  // ############################################################
  // EPIC 3: Marketing & Operations (COMPLETED)
  // ############################################################
  {
    guid: 'epic-3-marketing',
    type: 'Epic',
    title: 'Marketing & Operations',
    description: `
      <p>Build marketing tools and operational features for the website.</p>
      <h3>Scope</h3>
      <ul>
        <li>Contact forms and lead capture</li>
        <li>Newsletter signup and email integration</li>
        <li>Analytics and SEO optimization</li>
      </ul>
    `,
    priority: 2,
    state: 'Active',
    tags: ['epic', 'marketing', 'operations'],
    children: [
      // FEATURE 7: Contact & Forms
      {
        guid: 'feature-7-contact',
        type: 'Feature',
        title: 'Contact & Forms',
        description: '<p>Build contact page and form handling system.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['contact', 'forms'],
        children: [
          {
            guid: 'story-7-1-contact',
            type: 'User Story',
            title: 'Create contact page',
            description: '<p>As a visitor, I want to easily contact the company.</p>',
            storyPoints: 5,
            priority: 1,
            state: 'Closed',
            tags: ['contact'],
            children: [
              {
                guid: 'task-7-1-1',
                type: 'Task',
                title: 'Build contact form with validation',
                description: 'Create form with name, email, subject, message.',
                remainingWork: 6,
                priority: 1,
                state: 'Closed',
                tags: ['frontend', 'forms'],
              },
              {
                guid: 'task-7-1-2',
                type: 'Task',
                title: 'Add contact information section',
                description: 'Display address, phone, email, map.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-7-1-3',
                type: 'Task',
                title: 'Implement form submission API',
                description: 'Create API endpoint for form processing.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['backend', 'api'],
              },
            ],
          },
        ],
      },
      // FEATURE 8: Newsletter
      {
        guid: 'feature-8-newsletter',
        type: 'Feature',
        title: 'Newsletter Integration',
        description: '<p>Implement newsletter signup with email marketing integration.</p>',
        priority: 2,
        state: 'Closed',
        tags: ['newsletter', 'email'],
        children: [
          {
            guid: 'story-8-1-signup',
            type: 'User Story',
            title: 'Add newsletter signup widget',
            description: '<p>As a visitor, I want to subscribe to company updates.</p>',
            storyPoints: 3,
            priority: 2,
            state: 'Closed',
            tags: ['newsletter'],
            children: [
              {
                guid: 'task-8-1-1',
                type: 'Task',
                title: 'Create newsletter signup component',
                description: 'Build email input with subscribe button.',
                remainingWork: 3,
                priority: 2,
                state: 'Closed',
                tags: ['frontend'],
              },
              {
                guid: 'task-8-1-2',
                type: 'Task',
                title: 'Integrate with email marketing API',
                description: 'Connect to Mailchimp/SendGrid API.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['backend', 'api'],
              },
            ],
          },
        ],
      },
      // FEATURE 9: SEO & Analytics
      {
        guid: 'feature-9-seo',
        type: 'Feature',
        title: 'SEO & Analytics',
        description: '<p>Implement SEO best practices and analytics tracking.</p>',
        priority: 2,
        state: 'Closed',
        tags: ['seo', 'analytics'],
        children: [
          {
            guid: 'story-9-1-seo',
            type: 'User Story',
            title: 'Implement SEO optimization',
            description: '<p>As marketing, I want the site to rank well in search.</p>',
            storyPoints: 5,
            priority: 2,
            state: 'Closed',
            tags: ['seo'],
            children: [
              {
                guid: 'task-9-1-1',
                type: 'Task',
                title: 'Add meta tags and Open Graph',
                description: 'Implement dynamic meta tags for all pages.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['frontend', 'seo'],
              },
              {
                guid: 'task-9-1-2',
                type: 'Task',
                title: 'Create XML sitemap',
                description: 'Generate sitemap for search engines.',
                remainingWork: 3,
                priority: 2,
                state: 'Closed',
                tags: ['seo'],
              },
              {
                guid: 'task-9-1-3',
                type: 'Task',
                title: 'Implement structured data',
                description: 'Add JSON-LD for rich snippets.',
                remainingWork: 4,
                priority: 3,
                state: 'Closed',
                tags: ['frontend', 'seo'],
              },
            ],
          },
          {
            guid: 'story-9-2-analytics',
            type: 'User Story',
            title: 'Set up analytics tracking',
            description: '<p>As marketing, I want to track visitor behavior.</p>',
            storyPoints: 3,
            priority: 2,
            state: 'Closed',
            tags: ['analytics'],
            children: [
              {
                guid: 'task-9-2-1',
                type: 'Task',
                title: 'Integrate Google Analytics 4',
                description: 'Add GA4 tracking with event tracking.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['analytics'],
              },
              {
                guid: 'task-9-2-2',
                type: 'Task',
                title: 'Implement cookie consent',
                description: 'Add GDPR-compliant cookie banner.',
                remainingWork: 4,
                priority: 1,
                state: 'Closed',
                tags: ['frontend', 'compliance'],
              },
            ],
          },
        ],
      },
    ],
  },

  // ############################################################
  // EPIC 4: Website Support (ACTIVE - ongoing support)
  // ############################################################
  {
    guid: 'epic-4-support',
    type: 'Epic',
    title: 'Website Support',
    description: `
      <p>Ongoing support and maintenance for the corporate marketing website.</p>
      <h3>Scope</h3>
      <ul>
        <li>Bug fixes and incident response</li>
        <li>Content updates and minor enhancements</li>
        <li>Monthly checkpoint calls with stakeholders</li>
      </ul>
      <h3>Structure</h3>
      <p>Support is organized into monthly blocks. Each block contains a checkpoint call and support tickets from the month.</p>
    `,
    priority: 1,
    state: 'New',
    tags: ['ticket', 'epic', 'support'],
    children: [
      // ENABLER: Setup Support
      {
        guid: 'feature-support-enabler',
        type: 'Feature',
        title: 'Enabler: Support Setup',
        description: '<p>Initial setup tasks for ongoing website support engagement.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['ticket', 'enabler', 'setup'],
        children: [
          {
            guid: 'story-enabler-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want support infrastructure in place so that issues can be reported and resolved efficiently.</p>',
            storyPoints: 5,
            priority: 1,
            state: 'Closed',
            tags: ['ticket', 'enabler'],
            children: [
              {
                guid: 'task-enabler-1',
                type: 'Task',
                title: 'Initial kick-off call with client',
                description:
                  'Meet with stakeholders to understand support expectations and communication preferences.',
                remainingWork: 2,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'meeting'],
              },
              {
                guid: 'task-enabler-2',
                type: 'Task',
                title: 'Setup timesheets and billing',
                description: 'Configure time tracking and monthly billing process.',
                remainingWork: 2,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'admin'],
              },
              {
                guid: 'task-enabler-3',
                type: 'Task',
                title: 'Document support procedures',
                description: 'Create runbook for common support tasks and escalation procedures.',
                remainingWork: 4,
                priority: 2,
                state: 'Closed',
                tags: ['ticket', 'documentation'],
              },
              {
                guid: 'task-enabler-4',
                type: 'Task',
                title: 'Setup monitoring and alerts',
                description: 'Configure uptime monitoring and alert notifications.',
                remainingWork: 3,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'devops'],
              },
              {
                guid: 'task-enabler-5',
                type: 'Task',
                title: 'Create support email/portal access',
                description: 'Set up support ticket submission process for client.',
                remainingWork: 2,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'setup'],
              },
            ],
          },
        ],
      },
      // BLOCK 1 (COMPLETED - Month 1)
      {
        guid: 'feature-block-1',
        type: 'Feature',
        title: 'Block 1: October 2024',
        description:
          '<p>Support block for October 2024. Monthly support and maintenance tasks.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['ticket', 'block', 'block-1'],
        children: [
          {
            guid: 'story-block1-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['ticket', 'support', 'block-1'],
            children: [
              {
                guid: 'task-block1-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - October',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'meeting', 'recurring'],
              },
              ...generateSupportTickets(1, 35, 'Closed'),
            ],
          },
        ],
      },
      // BLOCK 2 (COMPLETED - Month 2)
      {
        guid: 'feature-block-2',
        type: 'Feature',
        title: 'Block 2: November 2024',
        description:
          '<p>Support block for November 2024. Monthly support and maintenance tasks.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['ticket', 'block', 'block-2'],
        children: [
          {
            guid: 'story-block2-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['ticket', 'support', 'block-2'],
            children: [
              {
                guid: 'task-block2-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - November',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'meeting', 'recurring'],
              },
              ...generateSupportTickets(2, 40, 'Closed'),
            ],
          },
        ],
      },
      // BLOCK 3 (COMPLETED - Month 3)
      {
        guid: 'feature-block-3',
        type: 'Feature',
        title: 'Block 3: December 2024',
        description:
          '<p>Support block for December 2024. Monthly support and maintenance tasks.</p>',
        priority: 1,
        state: 'Closed',
        tags: ['ticket', 'block', 'block-3'],
        children: [
          {
            guid: 'story-block3-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Closed',
            tags: ['ticket', 'support', 'block-3'],
            children: [
              {
                guid: 'task-block3-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - December',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'Closed',
                tags: ['ticket', 'meeting', 'recurring'],
              },
              ...generateSupportTickets(3, 38, 'Closed'),
            ],
          },
        ],
      },
      // BLOCK 4 (ACTIVE - Current month)
      {
        guid: 'feature-block-4',
        type: 'Feature',
        title: 'Block 4: January 2025',
        description:
          '<p>Support block for January 2025. Monthly support and maintenance tasks.</p>',
        priority: 1,
        state: 'Active',
        tags: ['ticket', 'block', 'block-4'],
        children: [
          {
            guid: 'story-block4-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'Active',
            tags: ['ticket', 'support', 'block-4'],
            children: [
              {
                guid: 'task-block4-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - January',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
              {
                guid: 'block4-ticket-1',
                type: 'Bug',
                title: 'Homepage carousel not auto-advancing',
                description:
                  '<p>The testimonial carousel has stopped auto-rotating after the recent deployment.</p><p>Reported by customer via support portal.</p>',
                priority: 2,
                tags: ['ticket', 'support', 'block-4'],
                state: 'Active',
              },
              {
                guid: 'block4-ticket-2',
                type: 'Task',
                title: 'Update Q1 promotional banner',
                description:
                  '<p>Replace holiday banner with new Q1 promotion graphics.</p><p>Requested by marketing team.</p>',
                remainingWork: 2,
                priority: 2,
                tags: ['ticket', 'support', 'block-4'],
                state: 'Active',
              },
              {
                guid: 'block4-ticket-3',
                type: 'Bug',
                title: 'Contact form email not reaching support inbox',
                description:
                  '<p>Form submissions are being delivered but not appearing in the support inbox. May be a spam filter issue.</p><p>Reported by customer via support portal.</p>',
                priority: 1,
                tags: ['ticket', 'support', 'block-4'],
                state: 'New',
              },
              {
                guid: 'block4-ticket-4',
                type: 'Task',
                title: 'Add new case study to resources',
                description:
                  '<p>Marketing has a new customer case study to add to the resources library.</p><p>Requested by marketing team.</p>',
                remainingWork: 3,
                priority: 3,
                tags: ['ticket', 'support', 'block-4'],
                state: 'New',
              },
              {
                guid: 'block4-ticket-5',
                type: 'Task',
                title: 'Add events section to homepage',
                description:
                  '<p>Add events section to homepage showing upcoming webinars and conferences.</p><p>Enhancement request from customer.</p>',
                remainingWork: 8,
                priority: 3,
                tags: ['ticket', 'support', 'block-4', 'enhancement'],
                state: 'New',
              },
            ],
          },
        ],
      },
      // BLOCK 5-12 (PENDING - Future months)
      {
        guid: 'feature-block-5',
        type: 'Feature',
        title: 'Block 5: February 2025',
        description:
          '<p>Support block for February 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-5'],
        children: [
          {
            guid: 'story-block5-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-5'],
            children: [
              {
                guid: 'task-block5-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - February',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-6',
        type: 'Feature',
        title: 'Block 6: March 2025',
        description: '<p>Support block for March 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-6'],
        children: [
          {
            guid: 'story-block6-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-6'],
            children: [
              {
                guid: 'task-block6-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - March',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-7',
        type: 'Feature',
        title: 'Block 7: April 2025',
        description: '<p>Support block for April 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-7'],
        children: [
          {
            guid: 'story-block7-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-7'],
            children: [
              {
                guid: 'task-block7-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - April',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-8',
        type: 'Feature',
        title: 'Block 8: May 2025',
        description: '<p>Support block for May 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-8'],
        children: [
          {
            guid: 'story-block8-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-8'],
            children: [
              {
                guid: 'task-block8-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - May',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-9',
        type: 'Feature',
        title: 'Block 9: June 2025',
        description: '<p>Support block for June 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-9'],
        children: [
          {
            guid: 'story-block9-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-9'],
            children: [
              {
                guid: 'task-block9-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - June',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-10',
        type: 'Feature',
        title: 'Block 10: July 2025',
        description: '<p>Support block for July 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-10'],
        children: [
          {
            guid: 'story-block10-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-10'],
            children: [
              {
                guid: 'task-block10-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - July',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-11',
        type: 'Feature',
        title: 'Block 11: August 2025',
        description: '<p>Support block for August 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-11'],
        children: [
          {
            guid: 'story-block11-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-11'],
            children: [
              {
                guid: 'task-block11-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - August',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
      {
        guid: 'feature-block-12',
        type: 'Feature',
        title: 'Block 12: September 2025',
        description:
          '<p>Support block for September 2025. Monthly support and maintenance tasks.</p>',
        priority: 2,
        state: 'New',
        tags: ['ticket', 'block', 'block-12'],
        children: [
          {
            guid: 'story-block12-support',
            type: 'User Story',
            title: 'As a user, I want to be supported',
            description:
              '<p>As a website owner, I want ongoing support so that bugs are fixed and my website stays healthy.</p>',
            storyPoints: 8,
            priority: 1,
            state: 'New',
            tags: ['ticket', 'support', 'block-12'],
            children: [
              {
                guid: 'task-block12-checkpoint',
                type: 'Task',
                title: 'Monthly checkpoint call - September',
                description: 'Review support tickets, discuss upcoming needs, plan for next month.',
                remainingWork: 1,
                priority: 1,
                state: 'New',
                tags: ['ticket', 'meeting', 'recurring'],
              },
            ],
          },
        ],
      },
    ],
  },
];
