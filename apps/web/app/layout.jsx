import './globals.css';
import SiteNav from '../components/SiteNav';

export const metadata = {
  title: 'مِطياف · Mityaf',
  description:
    'منصّة رصد المياه الحضرية بالأقمار الصناعية والذكاء الاصطناعي — أمانة منطقة المدينة المنورة',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl" data-theme="light">
      <head>
        {/* Runs before the body paints: without it a visitor who chose dark
            sees the light default first and watches it correct itself. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('mityaf-theme');`
              + `if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}`
              + `catch(e){}`,
          }}
        />
      </head>
      <body>
        {/* The radial glow and map grid moved to the landing page: they are a
            dark-hero aesthetic, and as fixed layers in the root layout they
            painted over the light console and showed through the transparent
            nav as a dark bar. */}
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
