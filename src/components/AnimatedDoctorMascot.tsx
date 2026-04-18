import { useState, useEffect, useRef } from "react";
import doctorCharacter from "@/assets/doctor-character.webp";

interface AnimatedDoctorMascotProps {
  isPasswordFocused: boolean;
  className?: string;
}

const AnimatedDoctorMascot = ({ isPasswordFocused, className = "" }: AnimatedDoctorMascotProps) => {
  const [eyePosition, setEyePosition] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || isPasswordFocused || isBlinking) return;

      const rect = containerRef.current.getBoundingClientRect();
      // Centro de referência para o tracking
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.5;

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;

      // Movimento amplo dentro da área dos olhos
      const maxMoveX = 14;
      const maxMoveY = 8;
      const x = Math.max(-maxMoveX, Math.min(maxMoveX, deltaX / 25));
      const y = Math.max(-maxMoveY, Math.min(maxMoveY, deltaY / 30));

      setEyePosition({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isPasswordFocused, isBlinking]);

  // Reset eyes position when password is focused
  useEffect(() => {
    if (isPasswordFocused) {
      setEyePosition({ x: 0, y: 0 });
    }
  }, [isPasswordFocused]);

  // Periodic blinking animation
  useEffect(() => {
    if (isPasswordFocused) return;

    const blinkInterval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
    }, 3000 + Math.random() * 2000);

    return () => clearInterval(blinkInterval);
  }, [isPasswordFocused]);

  const showClosedEyes = isPasswordFocused || isBlinking;

  const renderEye = () => (
    <div className="w-20 h-20 flex items-center justify-center">
      {showClosedEyes ? (
        // Closed eye (curved line)
        <div 
          className="w-6 h-2 border-b-[3px] border-[#2a2520] rounded-b-full transition-all duration-100"
        />
      ) : (
        // Open eye (Funko Pop style - pequeno ponto preto com brilho)
        <div 
          className="w-5 h-5 bg-[#1a1612] rounded-full relative transition-transform duration-75 ease-out"
          style={{ 
            transform: `translate(${eyePosition.x}px, ${eyePosition.y}px)` 
          }}
        >
          {/* White glint */}
          <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-white rounded-full" />
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Doctor character image */}
      <img 
        src={doctorCharacter} 
        alt="Doctor Character" 
        className="w-full h-full object-contain"
      />
      
      {/* Eyes container - alinhado com as sobrancelhas da arte */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-[88px]">
        {/* Left Eye */}
        <div className="relative">
          {renderEye()}
        </div>

        {/* Right Eye */}
        <div className="relative">
          {renderEye()}
        </div>
      </div>
    </div>
  );
};

export default AnimatedDoctorMascot;
