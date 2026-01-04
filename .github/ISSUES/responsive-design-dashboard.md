# Dashboard layout is not responsive - sidebar and table need mobile support

**Priority:** High
**Type:** Bug / Enhancement
**Status:** Open
**Created:** 2026-01-04

## Summary

The DevDesk dashboard (authenticated app experience) lacks responsive design support. While the landing page is properly responsive, the main application layout has significant issues on mobile and tablet devices.

## Issues Found

### 1. Sidebar Fixed Width (Critical)
**File:** `src/components/layout/Sidebar.tsx:141`
```tsx
<aside className="flex h-screen w-64 flex-col" ...>
```

**Problem:** The sidebar has a fixed width of `w-64` (256px) with no responsive breakpoints. On mobile devices, this takes up most of the screen width, leaving minimal space for content.

**Expected:** Sidebar should collapse to icons-only or be hidden behind a hamburger menu on mobile (< 768px).

---

### 2. No Mobile Navigation Toggle (Critical)
**Files:** `MainLayout.tsx`, `Header.tsx`

**Problem:** There is no hamburger menu or mechanism to toggle the sidebar on mobile. Users cannot navigate efficiently on small screens.

**Expected:** Add a menu toggle button in the header that shows/hides the sidebar on mobile.

---

### 3. Header Not Responsive
**File:** `src/components/layout/Header.tsx`

**Problem:** All header elements (search, Conversations button with text, notification icons, user menu) are visible at all screen sizes. This causes crowding on smaller screens.

**Issues:**
- Line 56: "Conversations" text should hide on mobile (show icon only)
- Line 29: Search bar could collapse to icon on mobile
- Multiple icon buttons will crowd together

**Expected:**
- Hide text labels on mobile, show icons only
- Collapsible search on mobile
- Responsive spacing between elements

---

### 4. Data Table Not Mobile-Friendly
**File:** `src/components/tickets/TicketList.tsx`

**Problem:** The ticket list uses a table with 8 columns that will require horizontal scrolling on mobile. No alternative mobile view exists.

**Expected:**
- Card-based layout for mobile (< 768px)
- Or, hide less important columns on smaller screens
- Consider responsive table patterns (stacked rows, etc.)

---

## Components That ARE Responsive (for reference)

**LandingPage.tsx** - Properly uses:
- `text-3xl sm:text-4xl lg:text-5xl` for responsive typography
- `grid-cols-1 md:grid-cols-2` for responsive grids
- `flex-col sm:flex-row` for responsive flex layouts

## Recommended Breakpoints

Following Tailwind conventions:
- **sm:** 640px (mobile landscape)
- **md:** 768px (tablet)
- **lg:** 1024px (desktop)

## Proposed Fixes

### 1. Sidebar - Add responsive behavior
```tsx
// Sidebar.tsx
const [isOpen, setIsOpen] = useState(false);

<aside className={`
  fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300
  ${isOpen ? 'translate-x-0' : '-translate-x-full'}
  md:relative md:translate-x-0
`}>
```

### 2. Add mobile menu toggle in Header
```tsx
// Header.tsx
<button
  className="md:hidden p-2"
  onClick={() => setSidebarOpen(!sidebarOpen)}
>
  <Menu size={24} />
</button>
```

### 3. Header - Use responsive hiding
```tsx
<span className="hidden sm:inline">Conversations</span>
```

### 4. TicketList - Add responsive card view or hide columns
```tsx
// Hide less important columns on mobile
<th className="hidden md:table-cell">Requested</th>
<th className="hidden lg:table-cell">Updated</th>
```

## Screenshots

### Current Desktop Layout
The desktop layout works well with the fixed 256px sidebar.

### Mobile Issues (simulated)
On screens < 768px:
- Sidebar takes ~40% of viewport width
- Table requires horizontal scrolling
- Header elements are crowded

## Environment

- Tailwind CSS v4
- Next.js 16
- React 19

---
*This issue was auto-generated during responsive design verification on 2026-01-04.*
