import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState, useEffect, useCallback } from "react";
import React from 'react';
import red_field from '/red_field.svg';
import blue_field from '/blue_field.svg';
import { Button } from "@shadcn/ui/components/button.tsx";
import { json } from "@tanstack/react-router/ssr/client";
type MatchType = {
  teamNum?: string | null;
  matchNum?: string | null;
  alliance?: string | null;
};

export const Route = createFileRoute("/match_start")({
  component: MatchStart,
  validateSearch: (search: Record<string, unknown>): MatchType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
    };
  },
})

function MatchStart() {
  const navigate = useNavigate();
  const { teamNum, matchNum, alliance } = Route.useSearch();
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [coordinates, setCoordinates] = useState([1000,1000]);
  
  const toggle = () => {
    setIsActive(!isActive);
  };

  const [isRotated, setIsRotated] = useState(false);


  const rotateField = () => {
    setIsRotated(!isRotated);
  };
  
  const reset = useCallback(() => {
    setIsActive(false);
    setSeconds(0);
  }, []);

  useEffect(() => {
    let interval = null;
    


    if (isActive) {
      interval = setInterval(() => {
        setSeconds(prev => prev + 0.01);
      }, 10);
      const timerId = setTimeout(() => {
        reset();
      }, 20*1000);
    } else if (interval) {
      clearInterval(interval);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive]);

  useEffect(() => {
    
      
  }, [coordinates]);
  
  return (
    //{teamNum && <span className="text-foreground"> | {teamNum}</span>}
    //{matchNum && <span className="text-foreground"> | {matchNum}</span>}
    
    <div className="flex flex-row justify-start items-center w-[869px] h-[440px] gap-[20px] p-[20px]">
      <div className="flex flex-col justify-between items-center w-[62px] h-[390px] bg-black-950 gap-[10px] py-[12px] rounded-[15px] border-[2px] border-[#1E1E1E]">
        <div className = "flex flex-col text-outfit text-xs justify-start items-center gap-[5px]">
          <p className="text-[#CDA745]">
            {"Q" + matchNum?.substring(matchNum.indexOf("qm")+2)}
          </p>

          <p>
            {teamNum?.substring(teamNum.indexOf("frc")+3)}
          </p>
        
          

        </div>
        <div className="flex flex-col items-center gap-[30px]">

          
          <svg width="30" height="29" viewBox="0 0 30 29" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g opacity="0.9" clip-path="url(#clip0_717_421)">
          <rect x="-35" y="-21" width="100" height="100" fill="background"/>
          <rect width="30" height="29" fill="url(#pattern0_717_421)"/>
          </g>
          <defs>
          <pattern id="pattern0_717_421" patternContentUnits="objectBoundingBox" width="1" height="1">
          </pattern>
          <clipPath id="clip0_717_421">
          <rect width="30" height="29" fill="background"/>
          </clipPath>
          </defs>
          </svg>

          
          <svg onClick = {rotateField} width="25" height="20" viewBox="0 0 25 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10.8947 19.9805L8.51203 19.2891C8.26205 19.2187 8.12144 18.957 8.19174 18.707L13.5234 0.338417C13.5937 0.0883983 13.8554 -0.0522373 14.1053 0.0180805L16.488 0.709539C16.738 0.779857 16.8786 1.04159 16.8083 1.29161L11.4766 19.6602C11.4024 19.9102 11.1446 20.0547 10.8947 19.9805ZM6.44188 15.5974L8.14097 13.7847C8.32064 13.5933 8.30892 13.2886 8.10972 13.1128L4.57093 9.9993L8.10972 6.88578C8.30892 6.70999 8.32454 6.40528 8.14097 6.21386L6.44188 4.40122C6.26611 4.21371 5.96926 4.20199 5.77787 4.38169L0.149402 9.65552C-0.0498008 9.83913 -0.0498008 10.1556 0.149402 10.3392L5.77787 15.6169C5.96926 15.7966 6.26611 15.7888 6.44188 15.5974ZM19.2221 15.6208L24.8506 10.3431C25.0498 10.1595 25.0498 9.84304 24.8506 9.65943L19.2221 4.37778C19.0346 4.20199 18.7378 4.2098 18.5581 4.39732L16.859 6.20995C16.6794 6.40137 16.6911 6.70608 16.8903 6.88188L20.4291 9.9993L16.8903 13.1128C16.6911 13.2886 16.6755 13.5933 16.859 13.7847L18.5581 15.5974C18.7339 15.7888 19.0307 15.7966 19.2221 15.6208Z" fill="#515151"/>
          </svg>
          <svg width="19" height="20" viewBox="0 0 19 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.3108 12.0157L16.6467 11.0547C16.8147 10.1485 16.8147 9.21879 16.6467 8.31254L18.3108 7.3516C18.5022 7.24222 18.5881 7.01566 18.5256 6.80472C18.092 5.4141 17.3538 4.15629 16.3889 3.10941C16.2405 2.94926 15.9983 2.91019 15.8108 3.01957L14.1467 3.98051C13.4475 3.37894 12.6428 2.9141 11.7717 2.60941V0.691443C11.7717 0.472693 11.6194 0.281287 11.4045 0.234412C9.97094 -0.0859009 8.50219 -0.0702759 7.13891 0.234412C6.92407 0.281287 6.77172 0.472693 6.77172 0.691443V2.61332C5.90454 2.92191 5.09985 3.38676 4.39672 3.98441L2.73657 3.02347C2.54516 2.9141 2.30688 2.94926 2.15844 3.11332C1.1936 4.15629 0.455317 5.4141 0.0217234 6.80863C-0.0446828 7.01957 0.0451609 7.24613 0.236567 7.3555L1.90063 8.31644C1.73266 9.22269 1.73266 10.1524 1.90063 11.0586L0.236567 12.0196C0.0451609 12.1289 -0.0407766 12.3555 0.0217234 12.5664C0.455317 13.9571 1.1936 15.2149 2.15844 16.2618C2.30688 16.4219 2.54907 16.461 2.73657 16.3516L4.40063 15.3907C5.09985 15.9922 5.90454 16.4571 6.77563 16.7618V18.6836C6.77563 18.9024 6.92797 19.0938 7.14282 19.1407C8.57641 19.461 10.0452 19.4453 11.4084 19.1407C11.6233 19.0938 11.7756 18.9024 11.7756 18.6836V16.7618C12.6428 16.4532 13.4475 15.9883 14.1506 15.3907L15.8147 16.3516C16.0061 16.461 16.2444 16.4258 16.3928 16.2618C17.3577 15.2188 18.0959 13.961 18.5295 12.5664C18.5881 12.3516 18.5022 12.125 18.3108 12.0157ZM9.27172 12.8086C7.54907 12.8086 6.14672 11.4063 6.14672 9.68363C6.14672 7.96097 7.54907 6.55863 9.27172 6.55863C10.9944 6.55863 12.3967 7.96097 12.3967 9.68363C12.3967 11.4063 10.9944 12.8086 9.27172 12.8086Z" fill="#515151"/>
          </svg>

          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_681_274)">
            <path d="M10.0178 0.312516C12.6064 0.317164 14.9567 1.33724 16.692 2.99552L18.0871 1.60041C18.6777 1.00982 19.6875 1.4281 19.6875 2.26334V7.50002C19.6875 8.01779 19.2678 8.43752 18.75 8.43752H13.5133C12.6781 8.43752 12.2598 7.42771 12.8504 6.83709L14.4813 5.20623C13.2756 4.07736 11.7156 3.45205 10.0582 3.43775C6.44891 3.40658 3.40652 6.32748 3.43773 10.0566C3.46734 13.5941 6.33531 16.5625 10 16.5625C11.6065 16.5625 13.1249 15.9892 14.3214 14.9392C14.5067 14.7767 14.7865 14.7866 14.9608 14.9608L16.5101 16.5101C16.7004 16.7004 16.691 17.0107 16.4913 17.1911C14.7735 18.7427 12.4971 19.6875 10 19.6875C4.64977 19.6875 0.312539 15.3503 0.3125 10.0001C0.312461 4.65599 4.67367 0.302945 10.0178 0.312516Z" fill="#515151"/>
            </g>
            <defs>
            <clipPath id="clip0_681_274">
            <rect width="20" height="20" fill="white"/>
            </clipPath>
            </defs>
          </svg>

          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clip-path="url(#clip0_681_272)">
          <path d="M9.98223 0.312516C7.39359 0.317164 5.04324 1.33724 3.30801 2.99552L1.91293 1.60045C1.3223 1.00982 0.3125 1.4281 0.3125 2.26334V7.50002C0.3125 8.01779 0.732227 8.43752 1.25 8.43752H6.48668C7.32191 8.43752 7.7402 7.42771 7.14961 6.83709L5.51875 5.20623C6.72437 4.07736 8.28441 3.45205 9.9418 3.43775C13.5511 3.40658 16.5935 6.32748 16.5623 10.0566C16.5327 13.5941 13.6647 16.5625 10 16.5625C8.39348 16.5625 6.87512 15.9892 5.67852 14.9392C5.49324 14.7767 5.21344 14.7866 5.03914 14.9608L3.48984 16.5101C3.29953 16.7004 3.30895 17.0107 3.50867 17.1911C5.22648 18.7427 7.50289 19.6875 10 19.6875C15.3502 19.6875 19.6875 15.3503 19.6875 10.0001C19.6875 4.65599 15.3263 0.302945 9.98223 0.312516Z" fill="#515151"/>
          </g>
          <defs>
          <clipPath id="clip0_681_272">
          <rect width="20" height="20" fill="white"/>
          </clipPath>
          </defs>
          </svg>


        
        </div>

      </div>
      
      <div className="w-[410px] h-[400px] px-[41px] py-[41px]" onClick=
      
      {e => 
      {const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - 41; // subtract padding
      const y = e.clientY - rect.top - 41;  // subtract padding
      setCoordinates([x, y]);
      }}>
      <div className="relative">
        

        <img 
        src={alliance == "red" ? red_field : blue_field}
        alt="Field" 
        style={{ 
          transform: isRotated ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.5s ease'
        }}/>
        {JSON.stringify(coordinates) != JSON.stringify([1000, 1000]) && (<div 
        className={`absolute top-${coordinates[0]}px left-${coordinates[1]}px`}
        style={{
          left: `${coordinates[0]}px`,
          top: `${coordinates[1]}px`,
          transform: 'translate(-50%, -50%)',
          
        }}
        >
         
         
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clip-path="url(#clip0_717_402)">
          <path d="M2 12C0.895431 12 0 11.1046 0 10C0 8.89543 0.895431 8 2 8H18C19.1046 8 20 8.89543 20 10C20 11.1046 19.1046 12 18 12L2 12Z" fill="#B73E3E"/>
          <rect x="8" width="4" height="20" rx="2" fill="#B73E3E"/>
          </g>
          <defs>
          <clipPath id="clip0_717_402">
          <rect width="20" height="20" fill="white"/>
          </clipPath>
          </defs>
          </svg>

        </div>)}
      </div>
      

      
      


    </div>
      
      
        
      <div className = "flex flex-col justify-center items-center w-[243px] h-[366px] gap-[10px] p-[10px] rounded-[15px] bg-black-950 border-[2px] border-[#1E1E1E]">
        <p className="text-outfit text-s w-[159px] h-[55px]">
            Select robot starting position
        </p>
        {JSON.stringify(coordinates) != JSON.stringify([1000, 1000]) && (
          <Button onClick = {() => {setCoordinates([1000,1000])}}>
          <div className="flex flex-col justify-center items-center w-[159px] h-[58px] px-[23px] py-[13px] rounded-[15px] gap-[10px] fill-none">
          
            <p className="text-outfit text-s">
              Reset Click
            </p>
          </div>
          </Button>
        )} 
        


        
        <Button disabled={JSON.stringify(coordinates) == JSON.stringify([1000, 1000])} onClick = {() => {
          //navigate({ to: "/" });
          setIsActive(!isActive);
          
        }}>
          <div className="flex flex-col justify-center items-center w-[159px] h-[58px] px-[23px] py-[13px] rounded-[15px] gap-[10px] fill-none">
            
          <p className="text-outfit text-s">
            Begin Match
          </p>
          </div>
          


        </Button>
      </div>

      <div className = "flex flex-col justify-start items-center w-[50px] h-[400px] px-[23px] py-[10px] rounded-[10px] gap-[10px] bg-black-950 border-[2px] border-[#1E1E1E]">
        <p className="text-xs text-[#CDA745]">
          {Math.round(seconds) + "/" + "20"}
        </p>
        <div className="flex flex-col gap-[0px]">
          
          <div style={{ height: `${seconds*300/20}px` }}  className = "flex flex-col w-[5px] bg-[#CDA745]">

          </div>
          <div style={{ height: `${300-seconds*300/20}px` }}  className = "flex flex-col w-[5px] bg-[#F4F4F4]">

          </div>
        </div>
        
      </div>
      
    </div>
  )
  
}