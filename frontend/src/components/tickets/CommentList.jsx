import { RoleBadge } from '../common/Badges';
import { formatDate } from '../../utils/format';

export default function CommentList({ comments }) {
  if (comments.length === 0) return <p className="muted">No comments yet.</p>;
  return (
    <ol className="comments">
      {comments.map((c) => (
        <li key={c.id} className="comment">
          <div className="comment-head">
            <span className="avatar" aria-hidden="true">{c.author.name.slice(0, 1).toUpperCase()}</span>
            <strong>{c.author.name}</strong>
            <RoleBadge role={c.author.role} />
            <span className="muted">{formatDate(c.createdAt)}</span>
          </div>
          <p className="comment-body">{c.message}</p>
        </li>
      ))}
    </ol>
  );
}
