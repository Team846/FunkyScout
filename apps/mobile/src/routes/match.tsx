import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectLabel, SelectGroup, SelectItem } from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.js";

import { toast } from "sonner";
import { logout } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";

export const Route = createFileRoute("/match")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();


  return (

    <div className="min-h-screen w-[390px] h-[844px] bg-background flex flex-col items-start p-[40px] gap-4 rounded-[15px] text-primary">

    
      
      <div className="flex w-full justify-start p-0">
        <svg width="14" height="23" viewBox="0 0 14 23" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0.356894 11.9495L10.2259 21.8185C10.7019 22.2945 11.4736 22.2945 11.9495 21.8185L13.1006 20.6674C13.5757 20.1923 13.5766 19.4222 13.1026 18.9459L5.2812 11.0877L13.1026 3.22957C13.5766 2.7533 13.5757 1.9832 13.1006 1.50804L11.9495 0.356979C11.4735 -0.118993 10.7018 -0.118993 10.2259 0.356979L0.356946 10.226C-0.119027 10.7019 -0.119027 11.4736 0.356894 11.9495Z" fill="#FBBF24"/>
        </svg>
      </div>
     
        <svg width="344" height="3" viewBox="0 0 344 3" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 1.5H342.5" stroke="#404040" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      
      
      
      <div className="flex flex-col items-start w-[304px] mt-4 gap-4  ">
        <p className="font-medium">Match Scouting</p>
        
        <div className="flex flex-col items-start w-full bg-[#0D0D0D] rounded-[20px] w-[304px] h-[160px] gap-[18px] px-[20px] py-[15px]">
           
            <Select>
                <SelectTrigger className="w-full flex items-center justify-between !h-[56px] ">
                    <SelectValue placeholder="Select a Match" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                      <SelectItem value="Match">Match 1</SelectItem>
                      <SelectItem value="banana">Match 2</SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>

            
            <div className="flex flex-row items-center gap-2 ">
                <Select>
                  <SelectTrigger className="w-full h-full !w-[201px] !h-[56px] py-0">
                      <SelectValue placeholder="Select a Match" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectGroup>
                        <SelectItem value="Match">Match 1</SelectItem>
                      </SelectGroup>
                  </SelectContent>
                </Select>

                
                <Button className="w-[53px] h-[53px] rounded-full bg-[#FBBF24] hover:bg-[#e2ac20] p-0" variant="default" size="icon">
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none"> 
                      <path d="M11.0546 1.74147L12.3428 0.419739C12.8883 -0.139913 13.7703 -0.139913 14.31 0.419739L25.5909 11.9879C26.1364 12.5475 26.1364 13.4525 25.5909 14.0062L14.31 25.5803C13.7645 26.1399 12.8825 26.1399 12.3428 25.5803L11.0546 24.2585C10.5033 23.6929 10.5149 22.7701 11.0778 22.2164L18.0703 15.3815H1.3927C0.620913 15.3815 0 14.7444 0 13.9526V12.0474C0 11.2556 0.620913 10.6185 1.3927 10.6185H18.0703L11.0778 3.7836C10.5091 3.22991 10.4975 2.30708 11.0546 1.74147Z" fill="#0D0D0D"/> 
                    </svg>
                </Button>
            </div>
        </div>


        <div className="flex flex-col items-start w-full gap-4 bg-[#0D0D0D] rounded-[20px] w-[304px] h-[234px] gap-[18px] px-[20px] py-[23px]">
            <p className="font-medium">Recommended Matches</p>
            

            
            <div className="rounded-[20px] w-[264px] h-[70px] bg-[#131313] px-[18px] py-[10px]">
                <div className = "flex justify-between">
                    <p className="font-medium ">Qualification 31</p>
                    <p className = "font-regular text-sm  text-muted-foreground"> 00:00</p>
                </div>

                <div className = "flex justify-between">
                <p className="font-regular text-sm  text-muted-foreground">Team 254</p>
                
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7.06934 1.08545L7.89316 0.261621C8.24199 -0.087207 8.80606 -0.087207 9.15117 0.261621L16.3652 7.47197C16.7141 7.8208 16.7141 8.38486 16.3652 8.72998L9.15117 15.944C8.80234 16.2929 8.23828 16.2929 7.89316 15.944L7.06934 15.1202C6.7168 14.7677 6.72422 14.1925 7.08418 13.8474L11.5559 9.58721H0.890625C0.39707 9.58721 0 9.19014 0 8.69658V7.50908C0 7.01553 0.39707 6.61846 0.890625 6.61846H11.5559L7.08418 2.3583C6.72051 2.01318 6.71309 1.43799 7.06934 1.08545Z" fill="#FBBF24"/>
                </svg>
                </div>

            </div>

            
            
            <div className="flex flex-row items-center gap-2">

                <div className="rounded-[20px] w-[264px] h-[70px] bg-[#131313] px-[18px] py-[10px]">
                    <div className = "flex justify-between">
                        <p className="font-medium ">Qualification 31</p>
                        <p className = "font-regular text-sm  text-muted-foreground"> 00:00</p>
                    </div>

                    <div className = "flex justify-between">
                    <p className="font-regular text-sm  text-muted-foreground">Team 254</p>
                    
                    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7.06934 1.08545L7.89316 0.261621C8.24199 -0.087207 8.80606 -0.087207 9.15117 0.261621L16.3652 7.47197C16.7141 7.8208 16.7141 8.38486 16.3652 8.72998L9.15117 15.944C8.80234 16.2929 8.23828 16.2929 7.89316 15.944L7.06934 15.1202C6.7168 14.7677 6.72422 14.1925 7.08418 13.8474L11.5559 9.58721H0.890625C0.39707 9.58721 0 9.19014 0 8.69658V7.50908C0 7.01553 0.39707 6.61846 0.890625 6.61846H11.5559L7.08418 2.3583C6.72051 2.01318 6.71309 1.43799 7.06934 1.08545Z" fill="#FBBF24"/>
                    </svg>
                    </div>

                </div>
                
                
            </div>
        </div>
      </div>

      <p className="font-regular text-sm  text-muted-foreground text-center">
        The match does NOT start after clicking the arrow button. Please lock orientation or turn off auto-rotate before scouting.
      </p>
    </div>
  );
}

