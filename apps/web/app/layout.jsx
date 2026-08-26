import './globals.css';

export const metadata = {
  title: 'مَسارب · Masareb',
  description:
    'منصّة رصد المياه الحضرية بالأقمار الصناعية والذكاء الاصطناعي — أمانة منطقة المدينة المنورة',
};

const NAV = [
  { href: '/', label: 'نظرة عامة' },
  { href: '/flood', label: 'الغَرَق' },
  { href: '/waste', label: 'الهَدْر' },
  { href: '/method', label: 'المنهجية' },
];

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="glow-backdrop" />
        <div className="grid-overlay" />

        <nav className="topnav">
          <div className="navlinks">
            {NAV.map((n) => (
              <a key={n.href} href={n.href}>
                {n.label}
              </a>
            ))}
          </div>
          <div className="brandmark">
            <span>مَسارب · أمانة منطقة المدينة المنورة</span>
            <span className="dot" />
          </div>
        </nav>

        {children}
      </body>
    </html>
  );
}
