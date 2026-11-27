import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { ArrowLeft, Eye, EyeOff, KeyRound, LogOut, Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import { auth } from '../lib/firebase';
import { usePms } from '../context/PmsContext';

interface SuperAdminLoginPageProps {
  onGoToStaffLogin: () => void;
}

export const SuperAdminLoginPage: React.FC<SuperAdminLoginPageProps> = ({
  onGoToStaffLogin,
}) => {
  const { firebaseUser, bootstrapInitialized, authBlockReason, logout } = usePms();

  const [registerMode, setRegisterMode] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (registerMode && !bootstrapInitialized) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      // Clean redirect to main dashboard path after successful Firebase Auth sign-in
      if (window.location.pathname === '/superadmin') {
        window.history.replaceState({}, '', '/');
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : 'Đăng nhập SuperAdmin thất bại';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' ||
        msg.includes('invalid-credential')
      ) {
        setError('Email hoặc mật khẩu SuperAdmin không chính xác.');
      } else if (code === 'auth/operation-not-allowed') {
        setError(
          'Phương thức Email/Password chưa được bật trên Firebase Authentication Console.'
        );
      } else if (code === 'auth/too-many-requests') {
        setError('Thử đăng nhập sai quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.');
      } else if (code === 'auth/email-already-in-use') {
        setError('Email này đã tồn tại trên Firebase Authentication. Hãy đăng nhập trực tiếp.');
      } else if (code === 'auth/weak-password') {
        setError('Mật khẩu cần tối thiểu 6 ký tự.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#181816] flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] bg-white border border-[#E5E2DC] rounded-2xl p-8 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#1C1B18] text-[#A7F3D0] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-[#1C1B18] leading-tight">
              Cổng SuperAdmin gốc
            </h1>
            <p className="text-[12px] text-[#57534E]">
              Like Family PMS • Xác thực Firebase Authentication (Email/Mật khẩu)
            </p>
          </div>
        </div>

        <div className="mb-5 p-3 rounded-xl bg-[#FAF9F6] border border-[#E5E2DC] text-[12px] text-[#57534E] leading-relaxed">
          Trang đăng nhập riêng dành cho tài khoản <strong>SuperAdmin gốc</strong> quản trị Gemini
          API Keys, VietQR, Dọn ảnh cũ, Sao lưu dữ liệu và Phân quyền toàn hệ thống.
        </div>

        {authBlockReason && (
          <div className="mb-4 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] flex gap-2.5">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="text-[12px] leading-relaxed">{authBlockReason}</div>
          </div>
        )}

        {firebaseUser && authBlockReason ? (
          <button
            type="button"
            onClick={logout}
            className="w-full h-10 rounded-lg border border-[#E5E2DC] bg-white hover:bg-[#F7F6F3] text-[#1C1B18] text-[14px] font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
            Đăng xuất ({firebaseUser.email})
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[13px] text-[#991B1B]">
                {error}
              </div>
            )}

            {!bootstrapInitialized && registerMode && (
              <div>
                <label className="block text-[13px] font-medium text-[#57534E] mb-1.5">
                  Họ và tên SuperAdmin
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Lê Đức Phương"
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-[#57534E] mb-1.5">
                Email tài khoản SuperAdmin
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-[#8A847C] absolute left-3 top-3"
                  strokeWidth={1.5}
                />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ducphuong84@gmail.com"
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#57534E] mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <KeyRound
                  className="w-4 h-4 text-[#8A847C] absolute left-3 top-3"
                  strokeWidth={1.5}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu Firebase Auth"
                  className="w-full h-10 pl-9 pr-10 rounded-lg border border-[#E5E2DC] bg-white text-[#1C1B18] focus:outline-none focus:border-[#1B5E4B]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-2.5 text-[#8A847C] hover:text-[#1C1B18]"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-[#1C1B18] hover:bg-black disabled:opacity-50 text-white text-[14px] font-medium transition-colors"
            >
              {loading
                ? 'Đang xác thực Firebase...'
                : registerMode && !bootstrapInitialized
                ? 'Khởi tạo tài khoản SuperAdmin gốc'
                : 'Đăng nhập SuperAdmin'}
            </button>

            {!bootstrapInitialized && (
              <button
                type="button"
                onClick={() => setRegisterMode((v) => !v)}
                className="w-full text-[12px] text-[#1B5E4B] hover:underline"
              >
                {registerMode
                  ? 'Đã có tài khoản? Quay lại đăng nhập'
                  : 'Lần đầu cài đặt? Khởi tạo SuperAdmin gốc'}
              </button>
            )}
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-[#E5E2DC] flex items-center justify-between text-[12px]">
          <button
            type="button"
            onClick={onGoToStaffLogin}
            className="text-[#57534E] hover:text-[#1C1B18] inline-flex items-center gap-1.5 font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} />
            Về trang đăng nhập Nhân viên
          </button>
          <span className="font-mono-num text-[#8A847C]">/superadmin</span>
        </div>
      </div>
    </div>
  );
};
