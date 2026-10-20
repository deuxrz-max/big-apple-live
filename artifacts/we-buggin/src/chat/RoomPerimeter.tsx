/** Decorative only: a small gold highlight follows the screen edge, never the content. */
export function RoomPerimeter() {
  return (
    <svg className="ur-perimeter-shine" aria-hidden="true" focusable="false">
      <rect className="ur-perimeter-halo" x="1" y="1" rx="11" pathLength="100" />
      <rect className="ur-perimeter-trail" x="1" y="1" rx="11" pathLength="100" />
      <rect className="ur-perimeter-highlight" x="1" y="1" rx="11" pathLength="100" />
      <rect className="ur-perimeter-tip" x="1" y="1" rx="11" pathLength="100" />
    </svg>
  );
}
