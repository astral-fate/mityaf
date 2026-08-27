import './globals.css';
import SiteNav from '../components/SiteNav';

export const metadata = {
  title: 'مِطياف · Mityaf',
  description:
    'منصّة رصد المياه الحضرية بالأقمار الصناعية والذكاء الاصطناعي — أمانة منطقة المدينة المنورة',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="glow-backdrop" />
        <div className="grid-overlay" />
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
