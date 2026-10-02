import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './components/AuthContext.jsx'
import { AppShell } from './components/AppShell.jsx'
import { MemberGate } from './components/MemberGate.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { CommunityPage, NewsPage, PrivacyPage, QAPage, SubmitPage, SuggestPage } from './pages/PublicPages.jsx'
import { ForgotPage, LoginPage, ResetPasswordPage, VerifyPage } from './pages/AuthPages.jsx'
import { AccountPage } from './pages/AccountPage.jsx'
import { StaffPortal } from './pages/StaffPortal.jsx'
import { MomentsPage, ProfilePage, WallPage } from './pages/SocialPages.jsx'
import { NotificationsPage } from './pages/NotificationsPage.jsx'
import { PostDetailPage } from './pages/PostDetailPage.jsx'
import { ChatsPage, UserDirectoryPage } from './pages/ChatsPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route element={<MemberGate />}>
              <Route path="/community" element={<CommunityPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/qa" element={<QAPage />} />
              <Route path="/submit" element={<SubmitPage />} />
              <Route path="/suggest" element={<SuggestPage />} />
              <Route path="/moments" element={<MomentsPage />} />
              <Route path="/wall" element={<WallPage />} />
              <Route path="/space/:username" element={<ProfilePage />} />
              <Route path="/member/:userId" element={<ProfilePage />} />
              <Route path="/users" element={<UserDirectoryPage />} />
              <Route path="/chats" element={<ChatsPage />} />
              <Route path="/chats/:userId" element={<ChatsPage />} />
              <Route path="/me" element={<AccountPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/post/:type/:id" element={<PostDetailPage />} />
            </Route>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/forgot-password" element={<ForgotPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Route>
          <Route path="/htyzSlowSnow" element={<StaffPortal />} />
          <Route path="/htyzSlowSnow/activate" element={<ResetPasswordPage staff />} />
          <Route path="*" element={<div className="not-found"><h1>这里没有页面</h1><a href="/">返回首页</a></div>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
