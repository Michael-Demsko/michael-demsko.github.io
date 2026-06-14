import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import categories from "./data/categories.json";
import photos from "./data/photos.json";
import posts from "./data/posts.json";
import "./styles.css";

const todayKey = () => new Date().toISOString().slice(0, 10);

const normalizeHash = () => {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash || "";
};

const routeFromHash = (hash) => {
  const [section, maybeSlug] = hash.split("/");
  if (!section) return { view: "home" };
  if (section === "about") return { view: "about" };
  if (section === "post" && maybeSlug) return { view: "post", slug: maybeSlug };
  if (categories.some((category) => category.id === section)) {
    return { view: "category", category: section };
  }
  return { view: "home" };
};

const getPhotoForDate = (dateKey) => {
  const exact = photos.find((photo) => photo.date === dateKey);
  if (exact) return exact;

  const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date));
  const previous = [...sorted].reverse().find((photo) => photo.date <= dateKey);
  if (previous) return previous;

  const seed = [...dateKey].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return sorted[seed % sorted.length];
};

const formatDate = (date) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]));

function App() {
  const [hash, setHash] = useState(normalizeHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const route = routeFromHash(hash);
  const activePhoto = useMemo(() => getPhotoForDate(todayKey()), []);

  useEffect(() => {
    const onHashChange = () => {
      setHash(normalizeHash());
      setMenuOpen(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const filteredPosts = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return posts;
    return posts.filter((post) =>
      [post.title, post.summary, post.category, post.date, ...(post.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(trimmed),
    );
  }, [query]);

  return (
    <ColorTheme image={activePhoto.src}>
      <SiteFrame
        active={route.category}
        menuOpen={menuOpen}
        onMenuOpen={() => setMenuOpen(true)}
        onMenuClose={() => setMenuOpen(false)}
      >
        {route.view === "home" && (
          <Home photo={activePhoto} posts={filteredPosts} query={query} setQuery={setQuery} />
        )}
        {route.view === "about" && <About />}
        {route.view === "category" && (
          <CategoryPage category={categoryById[route.category]} posts={posts} />
        )}
        {route.view === "post" && <PostPage post={posts.find((post) => post.slug === route.slug)} />}
      </SiteFrame>
    </ColorTheme>
  );
}

function ColorTheme({ image, children }) {
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = image;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const size = 48;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 16) {
        const alpha = data[i + 3];
        if (alpha < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }

      if (!count) return;
      const color = [r, g, b].map((value) => Math.max(32, Math.round((value / count) * 0.82)));
      document.documentElement.style.setProperty("--photo-color", `rgb(${color.join(", ")})`);
    };
  }, [image]);

  return children;
}

function SiteFrame({ active, children, menuOpen, onMenuOpen, onMenuClose }) {
  return (
    <>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="michael demsko jr home">
          <img src="/images/logos/logo_test.svg" alt="" />
          <span>michael demsko jr</span>
        </a>
        <nav className="desktop-nav" aria-label="Primary">
          <a className={!active ? "active" : ""} href="#/">
            home
          </a>
          {categories.map((category) => (
            <a
              key={category.id}
              className={active === category.id ? "active" : ""}
              href={`#/${category.id}`}
              style={{ "--accent": category.color }}
            >
              {category.label}
            </a>
          ))}
          <a href="#/about">about</a>
        </nav>
        <button className="icon-button" type="button" onClick={onMenuOpen} aria-label="Open menu">
          <span aria-hidden="true">☰</span>
        </button>
      </header>

      {menuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="icon-button close" type="button" onClick={onMenuClose} aria-label="Close menu">
            <span aria-hidden="true">×</span>
          </button>
          <a href="#/">home</a>
          {categories.map((category) => (
            <a key={category.id} href={`#/${category.id}`} style={{ "--accent": category.color }}>
              {category.label}
            </a>
          ))}
          <a href="#/about">about</a>
        </div>
      )}

      <main>{children}</main>
    </>
  );
}

function Home({ photo, posts, query, setQuery }) {
  const [activeCategories, setActiveCategories] = useState([]);
  const [showScrollCue, setShowScrollCue] = useState(true);
  const categoryFilterRef = useRef(null);
  const visiblePosts = activeCategories.length
    ? posts.filter((post) => activeCategories.includes(post.category))
    : posts;

  const toggleCategory = (id) => {
    setActiveCategories((current) =>
      current.includes(id) ? current.filter((category) => category !== id) : [...current, id],
    );
  };

  useEffect(() => {
    const categoryFilter = categoryFilterRef.current;
    if (!categoryFilter) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollCue(!entry.isIntersecting),
      { threshold: 0.16 },
    );
    observer.observe(categoryFilter);

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <section className="photo-hero" aria-label="Photo of the day">
        <div className="photo-wrap">
          <div className="photo-frame">
            <img src={photo.src} alt={photo.title} />
          </div>
        </div>
        <div className="photo-caption">
          <span>photo of the day</span>
          <h1>{photo.title}</h1>
          <p>{formatDate(photo.date)}</p>
        </div>
        <div className={showScrollCue ? "scroll-cue" : "scroll-cue hidden"} aria-hidden="true">
          ⌄
        </div>
      </section>

      <section className="section-band">
        <div className="section-tools">
          <div className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search posts"
              aria-label="Search posts"
            />
          </div>
        </div>
        <CategoryFilter
          activeCategories={activeCategories}
          onToggle={toggleCategory}
          viewportRef={categoryFilterRef}
        />
        <PostGrid posts={visiblePosts} />
      </section>
    </>
  );
}

function CategoryFilter({ activeCategories, onToggle, viewportRef }) {
  return (
    <div className="category-filter" ref={viewportRef} aria-label="Filter posts by category">
      {categories.map((category) => {
        const selected = activeCategories.includes(category.id);
        return (
          <button
            key={category.id}
            className={selected ? "category-tile selected" : "category-tile"}
            type="button"
            onClick={() => onToggle(category.id)}
            style={{ "--accent": category.color, "--ink": category.ink }}
          >
            <span>{category.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PostGrid({ posts }) {
  return (
    <div className="post-grid">
      {posts.map((post) => (
        <a
          key={post.slug}
          className="post-card"
          href={`#/post/${post.slug}`}
          style={{
            "--accent": categoryById[post.category].color,
            "--ink": categoryById[post.category].ink,
          }}
        >
          <span className="post-category">{post.category}</span>
          <h2>{post.title}</h2>
          <p>{post.summary}</p>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
        </a>
      ))}
    </div>
  );
}

function CategoryPage({ category, posts }) {
  const categoryPosts = posts.filter((post) => post.category === category.id);

  return (
    <section className="page-shell">
      <div className="page-heading" style={{ "--accent": category.color, "--ink": category.ink }}>
        <p>{category.kicker}</p>
        <h1>{category.label}</h1>
      </div>
      <PostGrid posts={categoryPosts} />
    </section>
  );
}

function PostPage({ post }) {
  if (!post) {
    return (
      <section className="page-shell">
        <div className="page-heading">
          <p>missing</p>
          <h1>Post not found</h1>
        </div>
      </section>
    );
  }

  const category = categoryById[post.category];

  return (
    <article className="article-shell">
      <a className="back-link" href={`#/${post.category}`}>
        {post.category}
      </a>
      <header style={{ "--accent": category.color, "--ink": category.ink }}>
        <p>{formatDate(post.date)}</p>
        <h1>{post.title}</h1>
      </header>
      <div className="article-body">
        {post.embedHtml && (
          <div className="embed" dangerouslySetInnerHTML={{ __html: post.embedHtml }} />
        )}
        {(post.body || []).map((block, index) => {
          if (block.type === "heading") return <h2 key={index}>{block.text}</h2>;
          if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
          if (block.type === "list") {
            return (
              <ol key={index}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            );
          }
          if (block.type === "image") {
            return <img key={index} src={block.src} alt={block.alt} />;
          }
          return null;
        })}
      </div>
    </article>
  );
}

function About() {
  return (
    <section className="page-shell">
      <div className="page-heading">
        <p>about</p>
        <h1>michael demsko jr</h1>
      </div>
      <div className="about-copy">
        <p>
          A personal archive for work and play across ideas, music, writing, data, design, and
          photography.
        </p>
        <p>
          The site is structured as a static app: durable content, simple assets, and no runtime
          database dependency for visitors.
        </p>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
