import { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AnimeCard from '../AnimeCard/AnimeCard.jsx';
import './AnimeRow.css';

export default function AnimeRow({ title, anime = [], loading, viewAllLink, onViewAll, onBookmark, bookmarkedIds = [] }) {
  const containerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollButtons = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [anime, updateScrollButtons]);

  const scroll = (direction) => {
    const el = containerRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.8;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // Skeleton loading state
  if (loading) {
    return (
      <section className="anime-row">
        <div className="anime-row-header">
          <h2 className="anime-row-title">{title}</h2>
        </div>
        <div className="anime-row-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="anime-row-skeleton-card" />
          ))}
        </div>
      </section>
    );
  }

  if (!anime || anime.length === 0) return null;

  return (
    <section className="anime-row">
      {/* Header */}
      <div className="anime-row-header">
        <h2 className="anime-row-title">{title}</h2>
        {viewAllLink && (
          <Link to={viewAllLink} className="anime-row-view-all" onClick={onViewAll}>
            View All
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      {/* Scrollable Wrapper */}
      <div className="anime-row-wrapper">
        {/* Left Arrow */}
        <button
          className={`anime-row-arrow left${!canScrollLeft ? ' hidden' : ''}`}
          onClick={() => scroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={22} />
        </button>

        {/* Card Container */}
        <div className="anime-row-container" ref={containerRef}>
          {anime.map((item) => (
            <AnimeCard
              key={item.mal_id}
              anime={item}
              onBookmark={onBookmark}
              isBookmarked={bookmarkedIds.includes(item.mal_id)}
            />
          ))}
        </div>

        {/* Right Arrow */}
        <button
          className={`anime-row-arrow right${!canScrollRight ? ' hidden' : ''}`}
          onClick={() => scroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={22} />
        </button>
      </div>
    </section>
  );
}
