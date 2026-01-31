/**
 * Ancestor Node Component
 *
 * A reusable person node for tree visualizations.
 * Supports multiple sizes and lineage-based coloring.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { AncestryPersonCard } from '@fsf/shared';
import { AvatarPlaceholder } from '../../avatars/AvatarPlaceholder';
import { getLineageColor, getLineageColorWithOpacity, GENDER_COLORS } from '../utils/lineageColors';

export type NodeSize = 'xs' | 'sm' | 'md' | 'lg';
export type NodeVariant = 'card' | 'compact' | 'minimal';

interface AncestorNodeProps {
  person: AncestryPersonCard;
  dbId: string;

  // Sizing and variant
  size?: NodeSize;
  variant?: NodeVariant;

  // Lineage coloring (for fan chart, etc.)
  lineage?: 'paternal' | 'maternal' | 'self';
  generation?: number;
  useLineageColors?: boolean;

  // Expansion
  onExpand?: () => void;
  isExpanding?: boolean;
  expandDirection?: 'right' | 'down' | 'up';

  // Interaction
  onClick?: () => void;
  onNavigate?: (person: AncestryPersonCard) => void;
  disableLink?: boolean;

  // Display
  showId?: boolean;
  showDetails?: boolean;
  className?: string;
}

// Size configurations
const SIZE_CONFIG: Record<NodeSize, {
  container: string;
  avatar: string;
  avatarSize: string;
  name: string;
  details: string;
}> = {
  xs: {
    container: 'min-w-[140px] max-w-[180px] p-1.5',
    avatar: 'w-6 h-6',
    avatarSize: 'text-xs',
    name: 'text-xs',
    details: 'text-[9px]',
  },
  sm: {
    container: 'min-w-[160px] max-w-[200px] p-2',
    avatar: 'w-8 h-8',
    avatarSize: 'text-sm',
    name: 'text-xs',
    details: 'text-[10px]',
  },
  md: {
    container: 'min-w-[200px] max-w-[260px] p-3',
    avatar: 'w-10 h-10',
    avatarSize: 'text-lg',
    name: 'text-sm',
    details: 'text-xs',
  },
  lg: {
    container: 'min-w-[220px] max-w-[280px] p-4',
    avatar: 'w-12 h-12',
    avatarSize: 'text-xl',
    name: 'text-base',
    details: 'text-sm',
  },
};

export function AncestorNode({
  person,
  dbId,
  size = 'md',
  variant = 'card',
  lineage,
  generation = 1,
  useLineageColors = false,
  onExpand,
  isExpanding = false,
  expandDirection = 'right',
  onClick,
  onNavigate,
  disableLink = false,
  showId = false,
  showDetails = false,
  className = '',
}: AncestorNodeProps) {
  const [photoError, setPhotoError] = useState(false);
  const config = SIZE_CONFIG[size];

  useEffect(() => {
    setPhotoError(false);
  }, [person.photoUrl]);

  // Determine colors based on gender or lineage
  const genderColors = GENDER_COLORS[person.gender || 'unknown'];
  const lineageColor = useLineageColors && lineage && lineage !== 'self'
    ? getLineageColor(lineage, generation)
    : undefined;
  const lineageBgColor = useLineageColors && lineage && lineage !== 'self'
    ? getLineageColorWithOpacity(lineage, generation, 0.15)
    : undefined;

  // Border color
  const borderColor = lineageColor || genderColors.border;

  // Handle click
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (onNavigate) {
      onNavigate(person);
    }
  };

  // Handle expand click
  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onExpand && !isExpanding) {
      onExpand();
    }
  };

  // Get expand icon based on direction
  const ExpandIcon = expandDirection === 'down' ? ChevronDown :
    expandDirection === 'up' ? ChevronUp : ChevronRight;

  // Content based on variant
  const content = (
    <div
      data-person-id={person.id}
      className={`
        flex items-center gap-2 rounded-lg
        border-l-4 transition-all duration-200
        ${variant === 'card' ? 'bg-app-card shadow-md hover:shadow-lg' : 'bg-app-card/50 hover:bg-app-card'}
        ${config.container}
        ${className}
      `}
      style={{
        borderLeftColor: borderColor,
        backgroundColor: lineageBgColor || undefined,
        borderTopWidth: '1px',
        borderRightWidth: '1px',
        borderBottomWidth: '1px',
        borderTopColor: 'var(--color-app-border)',
        borderRightColor: 'var(--color-app-border)',
        borderBottomColor: 'var(--color-app-border)',
      }}
      onClick={handleClick}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center ${config.avatar}`}
        style={{ borderWidth: '2px', borderColor }}
      >
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

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-app-text truncate ${config.name}`}>
          {person.name}
        </div>
        <div className={`text-app-text-muted truncate ${config.details}`}>
          {person.lifespan}
        </div>
        {showId && (
          <div className={`text-app-text-subtle truncate ${config.details}`}>
            {person.id}
          </div>
        )}
        {showDetails && person.birthPlace && (
          <div className={`text-app-text-subtle truncate mt-0.5 ${config.details}`}>
            b. {person.birthPlace}
          </div>
        )}
      </div>

      {/* Expand button */}
      {person.hasMoreAncestors && onExpand && (
        <button
          onClick={handleExpandClick}
          disabled={isExpanding}
          className={`
            flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center
            bg-app-bg-secondary hover:bg-app-hover transition-colors
            ${isExpanding ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
          `}
          title="Load ancestors"
        >
          {isExpanding ? (
            <div className="w-3 h-3 border-2 border-app-text-muted border-t-transparent rounded-full animate-spin" />
          ) : (
            <ExpandIcon className="w-4 h-4 text-app-text-secondary" />
          )}
        </button>
      )}
    </div>
  );

  // Wrap in Link if not disabled
  if (disableLink || onClick || onNavigate) {
    return content;
  }

  return (
    <Link
      to={`/person/${dbId}/${person.id}`}
      className="block cursor-pointer"
    >
      {content}
    </Link>
  );
}

/**
 * Unknown ancestor placeholder node
 */
export function UnknownAncestorNode({
  label = 'Unknown',
  size = 'md',
  lineage,
  generation = 1,
  useLineageColors = false,
  className = '',
}: {
  label?: string;
  size?: NodeSize;
  lineage?: 'paternal' | 'maternal';
  generation?: number;
  useLineageColors?: boolean;
  className?: string;
}) {
  const config = SIZE_CONFIG[size];

  const lineageColor = useLineageColors && lineage
    ? getLineageColorWithOpacity(lineage, generation, 0.1)
    : undefined;

  return (
    <div
      className={`
        flex items-center gap-2 rounded-lg
        border-2 border-dashed border-app-border
        bg-app-card/30 opacity-60
        ${config.container}
        ${className}
      `}
      style={{ backgroundColor: lineageColor || undefined }}
    >
      <div className={`flex-shrink-0 rounded-full border-2 border-dashed border-app-border flex items-center justify-center ${config.avatar}`}>
        <span className={`text-app-text-muted ${config.avatarSize}`}>?</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-app-text-muted ${config.name}`}>{label}</div>
      </div>
    </div>
  );
}

/**
 * Root person node with enhanced styling
 */
export function RootPersonNode({
  person,
  dbId,
  className = '',
}: {
  person: AncestryPersonCard;
  dbId: string;
  className?: string;
}) {
  const [photoError, setPhotoError] = useState(false);
  const genderColors = GENDER_COLORS[person.gender || 'unknown'];

  useEffect(() => {
    setPhotoError(false);
  }, [person.photoUrl]);

  return (
    <Link
      to={`/person/${dbId}/${person.id}`}
      data-person-id={person.id}
      className={`
        block p-4 rounded-xl border-4 shadow-lg
        hover:shadow-xl transition-all
        ${className}
      `}
      style={{
        borderColor: genderColors.border,
        backgroundColor: genderColors.bg,
      }}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center border-4"
          style={{ borderColor: genderColors.border }}
        >
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
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold text-app-text">{person.name}</div>
          <div className="text-sm text-app-text-muted">{person.lifespan}</div>
          {person.birthPlace && (
            <div className="text-xs text-app-text-subtle mt-1">
              Born: {person.birthPlace}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
