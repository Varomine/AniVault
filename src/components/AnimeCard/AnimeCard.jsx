import { useNavigate } from 'react-router-dom';
import { Star, Play, Bookmark } from 'lucide-react';
import './AnimeCard.css';

export default function AnimeCard({ anime, onClick, onBookmark, isBookmarked }) {
  const navigate = useNavigate();

  if (!anime) return null;

  const imageUrl =
    anime.images?.jpg?.large_image_url ||
    anime.images?.jpg?.image_url ||
    '';

  const title = anime.title_english || anime.title || 'Untitled';
  const score = anime.score || null;
  const type = anime.type || '';
  const episodes = anime.episodes;
  const trailerUrl = anime.trailer?.url || '';

  const handleCardClick = (e) => {
    if (onClick) {
      onClick(anime);
    } else {
      navigate(`/anime/${anime.mal_id}`);
    }
  };

  const handleTrailerClick = (e) => {
    e.stopPropagation();
    if (trailerUrl) {
      window.open(trailerUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleBookmarkClick = (e) => {
    e.stopPropagation();
    if (onBookmark) {
      onBookmark(anime);
    }
  };

  return (
    <div className="anime-card" onClick={handleCardClick}>
      {/* Poster */}
      <img
        className="anime-card-image"
        src={imageUrl}
        alt={title}
        loading="lazy"
        draggable={false}
      />

      {/* Score Badge */}
      {score && (
        <div className="anime-card-score">
          <Star size={11} />
          {score.toFixed(1)}
        </div>
      )}

      {/* Hover Overlay */}
      <div className="anime-card-overlay">
        <div className="anime-card-info">
          <span className="anime-card-title">{title}</span>
          <div className="anime-card-meta">
            {type && <span>{type}</span>}
            {type && episodes != null && <span className="anime-card-meta-dot" />}
            {episodes != null && (
              <span>{episodes === 0 ? '?' : episodes} ep{episodes !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="anime-card-actions">
        {trailerUrl && (
          <button
            className="anime-card-action-btn"
            onClick={handleTrailerClick}
            aria-label="Watch trailer"
            title="Watch trailer"
          >
            <Play size={12} fill="currentColor" />
          </button>
        )}
        <button
          className={`anime-card-action-btn${isBookmarked ? ' bookmarked' : ''}`}
          onClick={handleBookmarkClick}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
}
