import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AncestryPersonCard } from '@fsf/shared';
import { AvatarPlaceholder } from '../avatars/AvatarPlaceholder';

interface PersonCardProps {
  person: AncestryPersonCard;
  dbId: string;
  onExpand?: () => void;
  isLoading?: boolean;
}

export function PersonCard({ person, dbId, onExpand, isLoading }: PersonCardProps) {
  const navigate = useNavigate();
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    setPhotoError(false);
  }, [person.photoUrl]);

  const handleCardClick = () => {
    navigate(`/person/${dbId}/${person.id}`);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) {
      onExpand();
    }
  };

  // Gender-based border color
  const borderColor =
    person.gender === 'male'
      ? 'border-l-app-male'
      : person.gender === 'female'
        ? 'border-l-app-female'
        : 'border-l-app-text-subtle';

  return (
    <div
      data-person-id={person.id}
      className={`
        flex items-center gap-3 p-3 bg-app-card rounded-lg
        border-l-4 ${borderColor}
        hover:shadow-lg cursor-pointer transition-all duration-200
        min-w-[220px] max-w-[280px] shadow-md
      `}
      style={{ borderTop: '1px solid var(--color-app-border)', borderRight: '1px solid var(--color-app-border)', borderBottom: '1px solid var(--color-app-border)' }}
      onClick={handleCardClick}
    >
      {/* Circular photo or placeholder */}
      <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden bg-app-bg-secondary flex items-center justify-center">
        {person.photoUrl && !photoError ? (
          <img
            src={person.photoUrl}
            alt={person.name}
            className="w-full h-full object-cover"
            onError={() => setPhotoError(true)}
          />
        ) : (
          <AvatarPlaceholder gender={person.gender} className="w-full h-full" />
        )}
      </div>

      {/* Person info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-app-text text-sm truncate">{person.name}</div>
        <div className="text-xs text-app-text-muted truncate">{person.lifespan}</div>
        <div className="text-xs text-app-text-subtle truncate">{person.id}</div>
      </div>

      {/* Expand button */}
      {person.hasMoreAncestors && onExpand && (
        <button
          onClick={handleExpandClick}
          disabled={isLoading}
          className={`
            flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
            bg-app-bg-secondary hover:bg-app-hover transition-colors
            ${isLoading ? 'opacity-50 cursor-wait' : ''}
          `}
          title="Load ancestors"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
          ) : (
            <ChevronRight className="w-4 h-4 text-app-text-secondary" />
          )}
        </button>
      )}
    </div>
  );
}
