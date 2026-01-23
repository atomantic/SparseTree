import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as d3 from 'd3';
import { Network, Star, User, Download, Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { SparseTreeResult, SparseTreeNode, DatabaseInfo } from '@fsf/shared';
import { api } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';

export function SparseTreePage() {
  const { dbId } = useParams<{ dbId: string }>();
  const { theme } = useTheme();
  const [treeData, setTreeData] = useState<SparseTreeResult | null>(null);
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SparseTreeNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Load tree data and database info
  useEffect(() => {
    if (!dbId) return;

    setLoading(true);
    setError(null);

    Promise.all([
      api.getSparseTree(dbId),
      api.getDatabase(dbId),
    ])
      .then(([tree, db]) => {
        setTreeData(tree);
        setDatabase(db);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId]);

  // D3 tree rendering
  useEffect(() => {
    if (!treeData || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const margin = { top: 60, right: 40, bottom: 60, left: 40 };

    // Get computed CSS variable colors for theme support
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor = computedStyle.getPropertyValue('--color-app-text').trim() || '#ffffff';
    const mutedColor = computedStyle.getPropertyValue('--color-app-text-muted').trim() || '#9ca3af';
    const subtleColor = computedStyle.getPropertyValue('--color-app-text-subtle').trim() || '#6b7280';
    const cardColor = computedStyle.getPropertyValue('--color-app-card').trim() || '#1a1a1a';
    const borderColor = computedStyle.getPropertyValue('--color-app-border').trim() || '#2a2a2a';
    const bgSecondaryColor = computedStyle.getPropertyValue('--color-app-bg-secondary').trim() || '#171717';

    // Create main group for zoom/pan
    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${height - margin.bottom})`);

    // Create hierarchy from tree data
    const root = d3.hierarchy(treeData.root);

    // Use tree layout with vertical orientation - generous spacing for variable card heights
    const treeLayout = d3.tree<SparseTreeNode>()
      .nodeSize([180, 220])
      .separation((a, b) => a.parent === b.parent ? 1.2 : 1.8);

    treeLayout(root);

    // Flip Y coordinates so ancestors are on top (negate y values)
    root.each(d => {
      d.y = -(d.y ?? 0);
    });

    // Node card dimensions - vertical layout with photo on top, text below
    const cardWidth = 160;
    const photoSize = 60;

    // Badge dimensions (for lineage indicators on cards)
    const badgeWidth = 32;
    const badgeHeight = 18;
    const badgeRadius = 9;
    const paternalColor = '#60a5fa';  // Blue
    const maternalColor = '#f472b6';  // Pink

    // Calculate card height based on name length (for poster printing - no truncation)
    const getCardHeight = (name: string, hasTags: boolean) => {
      const charsPerLine = 20;
      const lineHeight = 14;
      const nameLines = Math.ceil(name.length / charsPerLine);
      const baseHeight = 114; // photo area + padding + lifespan
      const nameHeight = nameLines * lineHeight;
      const tagHeight = hasTags ? 20 : 0;
      return baseHeight + nameHeight + tagHeight;
    };

    // Calculate badge positions for a node (overlapping card top by half badge height)
    // Male (♂) ALWAYS on left, Female (♀) ALWAYS on right
    const getBadgeOffset = (side: 'left' | 'right', cardHeight: number) => {
      // Position badge so half overlaps the card top edge
      const topY = -cardHeight / 2; // Center of badge at card top edge (half above, half below)
      if (side === 'left') {
        return { x: -cardWidth / 2 + badgeWidth / 2 + 12, y: topY }; // Left side
      } else {
        return { x: cardWidth / 2 - badgeWidth / 2 - 12, y: topY }; // Right side
      }
    };

    // Helper to calculate the actual path points for a link
    // Using HierarchyLink type (x/y are optional) but they're guaranteed after treeLayout is called
    const getLinkPoints = (d: d3.HierarchyLink<SparseTreeNode>) => {
      const sourceX = (d.source as d3.HierarchyPointNode<SparseTreeNode>).x ?? 0;
      const sourceY = (d.source as d3.HierarchyPointNode<SparseTreeNode>).y ?? 0;
      const targetX = (d.target as d3.HierarchyPointNode<SparseTreeNode>).x ?? 0;
      const targetY = (d.target as d3.HierarchyPointNode<SparseTreeNode>).y ?? 0;

      // Calculate source point - connect from badge based on ancestor's SPATIAL position
      // This prevents lines from crossing over the card
      const sourceCardHeight = getCardHeight(d.source.data.name, (d.source.data.tags?.length || 0) > 0);
      const childLineage = d.target.data.lineageFromParent;
      let startX = sourceX;
      let startY = sourceY - sourceCardHeight / 2; // Top of card

      if (childLineage === 'paternal' || childLineage === 'maternal') {
        // Determine which side to connect from based on ancestor's horizontal position
        // If ancestor is to the left, connect from left badge; if right, connect from right badge
        const side = targetX < sourceX ? 'left' : 'right';
        const offset = getBadgeOffset(side, sourceCardHeight);
        startX = sourceX + offset.x;
        startY = sourceY + offset.y - badgeHeight / 2; // Top of badge
      }

      // Target is bottom of the ancestor card
      const targetCardHeight = getCardHeight(d.target.data.name, (d.target.data.tags?.length || 0) > 0);
      const endX = targetX;
      const endY = targetY + targetCardHeight / 2;

      return { startX, startY, endX, endY };
    };

    // Draw links with custom paths that connect to badge positions based on lineage
    const links = g.selectAll('.link')
      .data(root.links())
      .enter()
      .append('g')
      .attr('class', 'link-group');

    // Draw links - connecting to badge positions based on child's lineage
    links.append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', borderColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', d => d.target.data.generationsSkipped ? '6,4' : 'none')
      .attr('d', d => {
        const { startX, startY, endX, endY } = getLinkPoints(d);

        // Create curved path with control points for smooth curve
        const midY = (startY + endY) / 2;
        return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
      });

    // Add generation skip labels on links - positioned at the TRUE midpoint of the curved path
    links.each(function(d) {
      const targetData = d.target.data;
      if (targetData.generationsSkipped && targetData.generationsSkipped > 0) {
        const { startX, startY, endX, endY } = getLinkPoints(d);

        // Calculate the actual midpoint of the bezier curve (at t=0.5)
        // For cubic bezier: P = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        // With our control points: P0=(startX,startY), P1=(startX,midY), P2=(endX,midY), P3=(endX,endY)
        const midY = (startY + endY) / 2;
        const t = 0.5;
        const bezierX = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * startX + 3 * (1-t) * Math.pow(t, 2) * endX + Math.pow(t, 3) * endX;
        const bezierY = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * midY + 3 * (1-t) * Math.pow(t, 2) * midY + Math.pow(t, 3) * endY;

        const labelWidth = targetData.generationsSkipped > 99 ? 70 : 55;

        d3.select(this)
          .append('rect')
          .attr('x', bezierX - labelWidth / 2)
          .attr('y', bezierY - 12)
          .attr('width', labelWidth)
          .attr('height', 24)
          .attr('rx', 12)
          .attr('fill', cardColor)
          .attr('stroke', borderColor)
          .attr('stroke-width', 1);

        d3.select(this)
          .append('text')
          .attr('x', bezierX)
          .attr('y', bezierY + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('font-weight', '500')
          .attr('fill', mutedColor)
          .text(`${targetData.generationsSkipped} gen`);
      }
    });

    // Draw nodes (person nodes only - no separate junction nodes)
    const nodes = g.selectAll('.node')
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        setSelectedNode(d.data);
      });

    // Draw card backgrounds with dynamic heights (person nodes only)
    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return;  // Skip junction nodes
      const node = d3.select(this);
      const cardHeight = getCardHeight(d.data.name, (d.data.tags?.length || 0) > 0);

      node.append('rect')
        .attr('x', -cardWidth / 2)
        .attr('y', -cardHeight / 2)
        .attr('width', cardWidth)
        .attr('height', cardHeight)
        .attr('rx', 10)
        .attr('fill', cardColor)
        .attr('stroke', borderColor)
        .attr('stroke-width', 1);
    });

    // Photo centered at top of card (person nodes only)
    nodes.filter(d => d.data.nodeType !== 'junction')
      .append('clipPath')
      .attr('id', d => `clip-${d.data.id}`)
      .append('circle')
      .attr('cx', 0)
      .attr('cy', d => {
        const cardHeight = getCardHeight(d.data.name, (d.data.tags?.length || 0) > 0);
        return -cardHeight / 2 + 12 + photoSize / 2;
      })
      .attr('r', photoSize / 2);

    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return;  // Skip junction nodes
      const node = d3.select(this);
      const cardHeight = getCardHeight(d.data.name, (d.data.tags?.length || 0) > 0);
      const photoY = -cardHeight / 2 + 12 + photoSize / 2;

      if (d.data.photoUrl) {
        node.append('image')
          .attr('x', -photoSize / 2)
          .attr('y', photoY - photoSize / 2)
          .attr('width', photoSize)
          .attr('height', photoSize)
          .attr('clip-path', `url(#clip-${d.data.id})`)
          .attr('href', d.data.photoUrl)
          .attr('preserveAspectRatio', 'xMidYMid slice');
      } else {
        node.append('circle')
          .attr('cx', 0)
          .attr('cy', photoY)
          .attr('r', photoSize / 2)
          .attr('fill', bgSecondaryColor)
          .attr('stroke', borderColor);

        node.append('text')
          .attr('x', 0)
          .attr('y', photoY + 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', '24px')
          .attr('fill', subtleColor)
          .text('👤');
      }
    });

    // Name label with full text wrapping (no truncation for poster printing, person nodes only)
    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return;  // Skip junction nodes
      const node = d3.select(this);
      const name = d.data.name;
      const cardHeight = getCardHeight(name, (d.data.tags?.length || 0) > 0);
      const nameStartY = -cardHeight / 2 + photoSize + 24;

      // Use foreignObject for HTML text wrapping - full text, no truncation
      const fo = node.append('foreignObject')
        .attr('x', -cardWidth / 2 + 8)
        .attr('y', nameStartY)
        .attr('width', cardWidth - 16)
        .attr('height', 200); // Large enough for any name

      fo.append('xhtml:div')
        .style('font-size', '11px')
        .style('font-weight', '600')
        .style('color', textColor)
        .style('line-height', '1.3')
        .style('text-align', 'center')
        .style('word-break', 'break-word')
        .text(name);
    });

    // Lifespan label (person nodes only)
    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return;  // Skip junction nodes
      const node = d3.select(this);
      const name = d.data.name;
      const hasTags = (d.data.tags?.length || 0) > 0;
      const cardHeight = getCardHeight(name, hasTags);
      const charsPerLine = 20;
      const nameLines = Math.ceil(name.length / charsPerLine);
      const lifespanY = -cardHeight / 2 + photoSize + 42 + nameLines * 14;

      node.append('text')
        .attr('x', 0)
        .attr('y', lifespanY)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', mutedColor)
        .text(d.data.lifespan);
    });

    // Tags badges (show all tags, full text, person nodes only)
    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return;  // Skip junction nodes
      if (!d.data.tags || d.data.tags.length === 0) return;
      const node = d3.select(this);
      const name = d.data.name;
      const cardHeight = getCardHeight(name, true);
      const charsPerLine = 20;
      const nameLines = Math.ceil(name.length / charsPerLine);
      const tagsY = -cardHeight / 2 + photoSize + 58 + nameLines * 14;

      // Calculate total width for centering
      const tagWidths = d.data.tags.map((tag: string) => tag.length * 5.5 + 12);
      const totalWidth = tagWidths.reduce((a: number, b: number) => a + b, 0) + (d.data.tags.length - 1) * 4;
      let xOffset = -totalWidth / 2;

      d.data.tags.forEach((tag: string, i: number) => {
        const tagPixelWidth = tagWidths[i];

        node.append('rect')
          .attr('x', xOffset)
          .attr('y', tagsY)
          .attr('width', tagPixelWidth)
          .attr('height', 14)
          .attr('rx', 7)
          .attr('fill', '#3b82f6')
          .attr('opacity', 0.15);

        node.append('text')
          .attr('x', xOffset + tagPixelWidth / 2)
          .attr('y', tagsY + 10)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('font-weight', '500')
          .attr('fill', '#60a5fa')
          .text(tag);

        xOffset += tagPixelWidth + 4;
      });
    });

    // Draw lineage badges LAST so they appear on top of card (z-index)
    // Male (♂) on left, Female (♀) on right
    nodes.each(function(d) {
      if (d.data.nodeType === 'junction') return; // Skip any old junction nodes
      const node = d3.select(this);
      const cardHeight = getCardHeight(d.data.name, (d.data.tags?.length || 0) > 0);

      // Draw paternal badge (left side) if this node has paternal ancestors
      if (d.data.hasPaternal) {
        const offset = getBadgeOffset('left', cardHeight);
        node.append('rect')
          .attr('x', offset.x - badgeWidth / 2)
          .attr('y', offset.y - badgeHeight / 2)
          .attr('width', badgeWidth)
          .attr('height', badgeHeight)
          .attr('rx', badgeRadius)
          .attr('fill', cardColor)
          .attr('stroke', paternalColor)
          .attr('stroke-width', 2);

        node.append('text')
          .attr('x', offset.x)
          .attr('y', offset.y - 1)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', '11px')
          .attr('fill', paternalColor)
          .text('♂');
      }

      // Draw maternal badge (right side) if this node has maternal ancestors
      if (d.data.hasMaternal) {
        const offset = getBadgeOffset('right', cardHeight);
        node.append('rect')
          .attr('x', offset.x - badgeWidth / 2)
          .attr('y', offset.y - badgeHeight / 2)
          .attr('width', badgeWidth)
          .attr('height', badgeHeight)
          .attr('rx', badgeRadius)
          .attr('fill', cardColor)
          .attr('stroke', maternalColor)
          .attr('stroke-width', 2);

        node.append('text')
          .attr('x', offset.x)
          .attr('y', offset.y - 1)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', '11px')
          .attr('fill', maternalColor)
          .text('♀');
      }
    });

    // Setup zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Initial transform to center and show tree
    const bounds = g.node()?.getBBox();
    if (bounds) {
      const dx = bounds.width;
      const dy = bounds.height;
      const x = bounds.x + dx / 2;
      const y = bounds.y + dy / 2;
      const scale = Math.min(0.8, 0.9 / Math.max(dx / width, dy / height));
      const translate = [width / 2 - scale * x, height / 2 - scale * y];

      svg.call(
        zoom.transform,
        d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
      );
    }

  }, [treeData, theme]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      const g = svg.select('g');
      const bounds = (g.node() as SVGGElement)?.getBBox();
      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;

      if (bounds) {
        const dx = bounds.width;
        const dy = bounds.height;
        const x = bounds.x + dx / 2;
        const y = bounds.y + dy / 2;
        const scale = Math.min(0.8, 0.9 / Math.max(dx / width, dy / height));
        const translate = [width / 2 - scale * x, height / 2 - scale * y];

        svg.transition().call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
        );
      }
    }
  };

  const handleExportSvg = () => {
    if (!svgRef.current) return;

    const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement;
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Get current theme colors for inline styles
    const computedStyle = getComputedStyle(document.documentElement);
    const borderColor = computedStyle.getPropertyValue('--color-app-border').trim() || '#2a2a2a';

    // Add styles inline
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      .link { fill: none; stroke: ${borderColor}; stroke-width: 2; }
      text { font-family: system-ui, -apple-system, sans-serif; }
    `;
    svgClone.insertBefore(styleEl, svgClone.firstChild);

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `sparse-tree-${dbId}.svg`;
    a.click();

    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-app-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-app-error mb-4">Error: {error}</p>
        <Link
          to="/favorites"
          className="text-app-accent hover:underline"
        >
          Back to Favorites
        </Link>
      </div>
    );
  }

  if (!treeData || treeData.totalFavorites === 0) {
    return (
      <div className="text-center py-16">
        <Network size={48} className="mx-auto text-app-text-subtle mb-4" />
        <h3 className="text-lg font-medium text-app-text-muted mb-2">
          No favorites in this database
        </h3>
        <p className="text-app-text-subtle mb-4">
          Mark some ancestors as favorites to see them in a sparse tree
        </p>
        <Link
          to={`/search/${dbId}`}
          className="text-app-accent hover:underline"
        >
          Search the database
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Network size={28} className="text-app-accent" />
          <div>
            <h1 className="text-2xl font-bold text-app-text">Sparse Tree</h1>
            <p className="text-sm text-app-text-muted">
              {database?.rootName || dbId} - {treeData.totalFavorites} favorites, {treeData.maxGeneration} generations
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to="/favorites"
            className="px-3 py-1.5 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm"
          >
            All Favorites
          </Link>
          <button
            onClick={handleExportSvg}
            className="px-3 py-1.5 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm flex items-center gap-1"
          >
            <Download size={14} />
            Export SVG
          </button>
        </div>
      </div>

      {/* Tree visualization */}
      <div className="flex-1 flex gap-4">
        <div className="flex-1 bg-app-card rounded-lg border border-app-border overflow-hidden relative">
          <svg ref={svgRef} className="w-full h-full" style={{ minHeight: '600px' }} />

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1">
            <button
              onClick={handleZoomIn}
              className="p-2 bg-app-bg border border-app-border rounded hover:bg-app-border"
              title="Zoom in"
            >
              <ZoomIn size={16} className="text-app-text-secondary" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 bg-app-bg border border-app-border rounded hover:bg-app-border"
              title="Zoom out"
            >
              <ZoomOut size={16} className="text-app-text-secondary" />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 bg-app-bg border border-app-border rounded hover:bg-app-border"
              title="Reset view"
            >
              <Maximize2 size={16} className="text-app-text-secondary" />
            </button>
          </div>
        </div>

        {/* Selected node panel */}
        {selectedNode && (
          <div className="w-80 bg-app-card rounded-lg border border-app-border p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-app-text flex items-center gap-2">
                {selectedNode.isFavorite && (
                  <Star size={16} className="text-yellow-400 fill-current" />
                )}
                {selectedNode.name}
              </h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-app-text-muted hover:text-app-text"
              >
                ×
              </button>
            </div>

            {/* Photo */}
            {selectedNode.photoUrl ? (
              <img
                src={selectedNode.photoUrl}
                alt={selectedNode.name}
                className="w-full h-48 object-cover rounded-lg mb-4"
              />
            ) : (
              <div className="w-full h-48 bg-app-bg rounded-lg flex items-center justify-center mb-4">
                <User size={48} className="text-app-text-subtle" />
              </div>
            )}

            <p className="text-app-text-muted mb-2">{selectedNode.lifespan}</p>
            <p className="text-sm text-app-text-subtle mb-4">
              Generation {selectedNode.generationFromRoot} from root
            </p>

            {/* Why interesting */}
            {selectedNode.whyInteresting && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-app-text-secondary mb-1">Why Interesting</h4>
                <p className="text-sm text-app-text-muted">{selectedNode.whyInteresting}</p>
              </div>
            )}

            {/* Tags */}
            {selectedNode.tags && selectedNode.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {selectedNode.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-app-accent/20 text-app-accent rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Link to person detail */}
            <Link
              to={`/person/${dbId}/${selectedNode.id}`}
              className="block w-full py-2 bg-app-accent text-app-text text-center rounded hover:bg-app-accent/80 transition-colors"
            >
              View Details
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
