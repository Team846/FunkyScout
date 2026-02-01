import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { Select, SelectTrigger, SelectValue, SelectContent, SelectLabel, SelectGroup, SelectItem } from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.js";
import { Input } from "@shadcn/ui/components/input.js"

import { toast } from "sonner";
import { logout } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";

interface EventProps {
  name: string;
  date: string;
  year: number;
}
export const Route = createFileRoute("/events")({
  component: Events,
})
export function EventComponent(props: EventProps){

    const navigate = useNavigate();

    const handleEventClick = () => {
        navigate({ to: "/home" });
        //onClick = {handleClick}
    }
    //fix the margin thing idk why its not aligning on its own
    return (
    <div className="flex flex-row items-center gap-2" onClick = {handleEventClick}>

        <div className="flex flex-col justify-between rounded-[8px] w-[221px] h-[55.33px] bg-accent border border-border px-[16px] py-[8px]">
            <div className = "flex justify-between items-between">
                <p className="font-regular text-xs text-primary">{props.name}</p>
                <p className = "font-regular text-xs  text-muted-foreground">{props.date}</p>
            </div>

            <div className = "flex justify-between items-between h-[19.67px]">
                <p className="font-regular text-xs  text-muted-foreground">{props.year}</p>
                
                
                <div className = "mt-[5px]"> 
                    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 9.13889V0L7.18056 4.56944L0 9.13889Z" fill="#FBBF24"/>
                    </svg>
                </div>
                

            </div>

        </div>
        
        
    </div>
    );
}

export function Events(){
    let events: EventProps[] = [{name: "Oregon", date: "3/5", year: 2026}, 
                            {name: "Sacremento", date: "3/20", year: 2026},
                            {name: "Aerospace", date: "4/2", year: 2026},
                            ]
    return (

        <div className = "flex flex-col min-h-screen bg-background w-[390px] h-[844px] gap-[10px] p-[32px] justify-center items-center rounded-[8px]">
            <div className = "flex flex-col w-[285px] h-[331px] gap-[15px] px-[20px] py-[24px] justify-center items-start rounded-[10px]">
                
                <Input
                placeholder="Search events..."
                className="
                    
                    h-[46px]
                    rounded-[20px]
                    text-xs
                    font-regular
                    !text-[#FBBF24]
                    bg-accent
                    border-border
                    focus-visible:ring-0
                    focus-visible:ring-offset-0
                "
                />
                


                
                <div className="flex flex-col items-start w-full bg-accent rounded-[20px] w-[245] gap-[10px] px-[12px] py-[16px]">
                    <ul className = "flex flex-col gap-[10px]">
                        {events.map((item, index) => (
                            
                            <li key={index}> <EventComponent name = {item.name} date = {item.date} year = {item.year}/></li> 
                        ))}
                    </ul>
                </div>
                
            </div>
        </div>
    )
    }

