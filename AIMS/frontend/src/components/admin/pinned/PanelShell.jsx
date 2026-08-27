/*
 * The chrome every card on a customisable screen wears.
 *
 * A built-in panel and a pinned query card have to be visually the same object
 * — same border, same header, same remove button in the same place — or the
 * grid reads as two kinds of thing that happen to be adjacent rather than one
 * arrangement the user made. This is that shared shell; what goes inside it is
 * the panel's own business.
 *
 * The height contract matters more than it looks: the shell is `height: 100%`
 * of a grid cell whose height the user drags, and the body is the flexible
 * part that scrolls. A panel that sets its own pixel height would either leave
 * dead space or spill over the card below it, so panels inside here size to
 * the body rather than to a number.
 */

import { Trash2, MoreHorizontal } from 'lucide-react';

export default function PanelShell({
  title,
  subtitle,
  icon: Icon,
  iconColor = '#6366F1',
  accessory,
  editing,
  removable,
  onRemove,
  onOpenMenu,
  bodyStyle,
  children,
}) {
  return (
    <div className="pin-card">
      <div className="pin-card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="pin-card-title" style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            {Icon && <Icon size={15} style={{ color: iconColor, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          </h3>
          {subtitle && <p className="pin-card-sub">{subtitle}</p>}
        </div>

        <div className="pin-card-tools">
          {accessory}

          {/*
            * The tools appear only while arranging. Outside edit mode this is
            * the screen it always was, and a remove button sitting on the
            * institute's headline figures is an invitation nobody asked for.
            */}
          {editing && (
            <>
              <button
                type="button" className="pin-icon-btn"
                onClick={onOpenMenu} title="Size and options"
              >
                <MoreHorizontal size={15} />
              </button>

              {removable && (
                <button
                  type="button" className="pin-icon-btn is-danger"
                  onClick={onRemove} title="Remove this panel"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="pin-card-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
