const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const S = ({ size = 20, sw, children, ...r }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...P} strokeWidth={sw || 2} {...r}>{children}</svg>
)
export const Lock = (p) => <S {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></S>
export const Globe = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></S>
export const EyeOff = (p) => <S {...p}><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.9 9.9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22" /></S>
export const Eye = (p) => <S {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></S>
export const UserPlus = (p) => <S {...p}><circle cx="9" cy="8" r="4" /><path d="M1.5 21a7.5 7.5 0 0 1 15 0M19 8v6M16 11h6" /></S>
export const People = (p) => <S {...p}><circle cx="9" cy="8" r="4" /><path d="M1.5 21a7.5 7.5 0 0 1 15 0M16 4.2a4 4 0 0 1 0 7.6M22.5 21a7.5 7.5 0 0 0-4.5-6.9" /></S>
export const Trash = (p) => <S {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></S>
export const Exit = (p) => <S {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></S>
export const ShareI = (p) => <S {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></S>
export const LinkI = (p) => <S {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></S>
export const Warn = (p) => <S {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></S>
export const Check = (p) => <S {...p} sw={3}><path d="M4 12l5 5L20 6" /></S>
export const X = (p) => <S {...p} sw={3}><path d="M6 6l12 12M18 6L6 18" /></S>
export const Dots = ({ size = 18 }) => (<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>)
export const Gear = (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></S>
export const ListI = (p) => <S {...p} size={18}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" fill="currentColor" /><circle cx="3.5" cy="12" r="1" fill="currentColor" /><circle cx="3.5" cy="18" r="1" fill="currentColor" /></S>
export const Grid4 = (p) => <S {...p} size={18}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></S>
export const Home = (p) => <S {...p}><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></S>
export const Bookmark = (p) => <S {...p}><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></S>
export const Folder = (p) => <S {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>
export const ChatI = (p) => <S {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" /></S>
export const Pen = (p) => <S {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></S>
export const Mail = (p) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></S>
export const FolderBig = () => (<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>)
export const Search = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>

export const Masonry = (p) => <S {...p} size={18}><rect x="3" y="3" width="7.5" height="10" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="6" rx="1.5" /><rect x="3" y="16" width="7.5" height="5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /></S>
export const Palette = (p) => <S {...p}><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.4-1-2.4 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z" /><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" /></S>
export const Pulse = (p) => <S {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></S>
export const Clock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>
export const QrI = (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4" /></S>
export const DownloadI = (p) => <S {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 19h14" /></S>
export const SendI = (p) => <S {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></S>
export const UserI = (p) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>
export const CardI = (p) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.6 1.7-2.4 3-2.4s2.5.8 3 2.4M14.5 10h3.5M14.5 13.5h3.5" /></S>
export const StarI = (p) => <S {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></S>
export const BanI = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></S>
export const ShieldI = (p) => <S {...p}><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></S>
export const BulbI = (p) => <S {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" /></S>
