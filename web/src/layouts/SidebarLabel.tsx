import { NavLink, type NavLinkProps } from 'react-router-dom';
import { Tooltip } from 'antd';
import { cn } from '@/lib/utils';
import { useUI } from '@/store/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';

type Props = { type?: 'link' | 'span'; className?: string; children: React.ReactNode } & Partial<Pick<NavLinkProps, 'to' | 'end'>>;

/**
 * Menu text, built on NavLink (from SchoolMate's SidebarLabel). The link fills the whole row so the tap target
 * is large; closing the phone drawer on navigation happens here, so every menu entry behaves the same way.
 * `type="span"` is for parents that only open a submenu.
 */
export default function SidebarLabel({ to, end, type = 'link', className, children }: Props) {
  const collapsed = useUI((s) => s.menuCollapsed);
  const closeDrawer = useUI((s) => s.closeDrawer);
  const desktop = useIsDesktop();
  const text = <span className={cn('truncate', className)}>{children}</span>;

  if (type === 'span' || !to) {
    return desktop && collapsed ? (
      <Tooltip placement="right" title={typeof children === 'string' ? children : ''}>
        {text}
      </Tooltip>
    ) : (
      text
    );
  }

  return (
    <NavLink
      to={to}
      end={end ?? to === '/'}
      onClick={closeDrawer}
      className={cn('block w-full truncate', className)}
      style={{ color: 'inherit' }}
    >
      {children}
    </NavLink>
  );
}
