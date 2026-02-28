import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import red_field from "/red_field.svg";
import blue_field from "/blue_field.svg";
import { Button } from "@shadcn/ui/components/button.tsx";
import { getMatchLabel } from "@lib/utils/match";
import { useOrientation } from "@lib/hooks/useOrientation";
import { RotateDevicePrompt } from "../components/RotateDevicePrompt";





type MatchEndType = {
  teamNum?: string | null;
  matchNum?: string | null;
  alliance?: string | null;
  practice?: boolean | null;
};


export const Route = createFileRoute("/match_end")({
  component: MatchEnd,
  validateSearch: (search: Record<string, unknown>) : MatchEndType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
      practice: search.practice as boolean | undefined | null,
    };
  },
})

function MatchEnd() {
  const { isWrongOrientation } = useOrientation('landscape');
  const navigate = useNavigate();
  const { teamNum, matchNum, alliance, practice } = Route.useSearch();
  const [coordinates, setCoordinates] = useState([1000, 1000]);
  const handleBackClick = () => {
    if (practice) {
      navigate({ to: "/practice" });
    } else {
      navigate({ to: "/home" });
    }
  };

  const handleGoToSummary = () => {
    navigate({
      to: "/match_edit_stats",
      search: { teamNum, matchNum, alliance, practice, fromMatchEnd: true }
    });
  };

  const [isRotated, setIsRotated] = useState(false);

  const rotateField = () => {
    setIsRotated(!isRotated);
  };


  


  
  return (
    <>
      {isWrongOrientation && <RotateDevicePrompt />}
      {/* {teamNum && <span className="text-foreground"> | {teamNum}</span>} */}
      {/* {matchNum && <span className="text-foreground"> | {matchNum}</span>} */}
      <div className="flex flex-row w-screen h-screen gap-5 py-5 pr-5 pl-[max(1.25rem,env(safe-area-inset-left,0px))]">
      <div className="flex flex-col justify-between items-center w-[10vw] shrink-0 h-full bg-background gap-2.5 py-3 rounded-[15px] border-2 border-[#1E1E1E]">
        <div className="flex w-[62px] flex-col text-outfit text-xs justify-start items-center gap-[5px]">
          <p className="text-[#CDA745]">
            {matchNum ? getMatchLabel(matchNum) : ""}
          </p>

          <p>{teamNum?.substring(teamNum.indexOf("frc") + 3)}</p>
        </div>
        <div className="flex flex-col items-center gap-[30px]">
          <svg
                
                viewBox="0 0 25 20"
                onClick={handleBackClick}
                fill="currentColor"
                style={{ width: 25, height: 25 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                <path fill = "#515151" d="M12.1688 5.04384L4.16666 11.6345V18.7478C4.16666 18.932 4.23983 19.1086 4.37006 19.2389C4.50029 19.3691 4.67693 19.4423 4.8611 19.4423L9.72482 19.4297C9.9084 19.4288 10.0841 19.3552 10.2136 19.2251C10.3431 19.0949 10.4158 18.9188 10.4158 18.7352V14.5812C10.4158 14.397 10.489 14.2204 10.6192 14.0901C10.7494 13.9599 10.9261 13.8867 11.1102 13.8867H13.888C14.0722 13.8867 14.2488 13.9599 14.3791 14.0901C14.5093 14.2204 14.5825 14.397 14.5825 14.5812V18.7322C14.5822 18.8236 14.5999 18.9141 14.6347 18.9986C14.6695 19.0831 14.7206 19.1599 14.7851 19.2247C14.8496 19.2894 14.9263 19.3407 15.0106 19.3758C15.095 19.4108 15.1855 19.4288 15.2769 19.4288L20.1389 19.4423C20.3231 19.4423 20.4997 19.3691 20.6299 19.2389C20.7602 19.1086 20.8333 18.932 20.8333 18.7478V11.6298L12.8329 5.04384C12.7388 4.96802 12.6217 4.92668 12.5009 4.92668C12.3801 4.92668 12.2629 4.96802 12.1688 5.04384ZM24.809 9.52344L21.1805 6.53255V0.520833C21.1805 0.3827 21.1257 0.250224 21.028 0.152549C20.9303 0.0548735 20.7978 0 20.6597 0H18.2292C18.091 0 17.9585 0.0548735 17.8609 0.152549C17.7632 0.250224 17.7083 0.3827 17.7083 0.520833V3.67231L13.8225 0.47526C13.4496 0.168394 12.9816 0.000613431 12.4987 0.000613431C12.0158 0.000613431 11.5478 0.168394 11.1749 0.47526L0.188362 9.52344C0.135623 9.56703 0.0919888 9.62058 0.0599541 9.68104C0.0279193 9.7415 0.00811156 9.80768 0.00166252 9.8758C-0.00478653 9.94392 0.00224954 10.0126 0.0223687 10.078C0.0424879 10.1434 0.0752958 10.2042 0.118918 10.2569L1.22569 11.6024C1.26919 11.6553 1.3227 11.6991 1.38315 11.7313C1.44361 11.7635 1.50981 11.7835 1.57799 11.79C1.64616 11.7966 1.71496 11.7897 1.78045 11.7696C1.84593 11.7496 1.90682 11.7168 1.95963 11.6732L12.1688 3.26432C12.2629 3.18851 12.3801 3.14717 12.5009 3.14717C12.6217 3.14717 12.7388 3.18851 12.8329 3.26432L23.0425 11.6732C23.0952 11.7168 23.156 11.7496 23.2214 11.7697C23.2868 11.7898 23.3556 11.7969 23.4237 11.7904C23.4918 11.784 23.558 11.7642 23.6184 11.7321C23.6789 11.7001 23.7324 11.6565 23.776 11.6037L24.8828 10.2582C24.9264 10.2052 24.9591 10.1441 24.9789 10.0784C24.9988 10.0128 25.0055 9.94379 24.9987 9.8755C24.9918 9.80722 24.9715 9.74096 24.939 9.68054C24.9064 9.62012 24.8623 9.56673 24.809 9.52344Z" />
              </svg>

          <svg width="30" height="30" viewBox="0 0 24 24"   xmlns="http://www.w3.org/2000/svg" onClick={rotateField}>
            <path d="M5 7H6C6.53043 7 7.03914 6.78929 7.41421 6.41421C7.78929 6.03914 8 5.53043 8 5C8 4.73478 8.10536 4.48043 8.29289 4.29289C8.48043 4.10536 8.73478 4 9 4H15C15.2652 4 15.5196 4.10536 15.7071 4.29289C15.8946 4.48043 16 4.73478 16 5C16 5.53043 16.2107 6.03914 16.5858 6.41421C16.9609 6.78929 17.4696 7 18 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V18C21 18.5304 20.7893 19.0391 20.4142 19.4142C20.0391 19.7893 19.5304 20 19 20H5C4.46957 20 3.96086 19.7893 3.58579 19.4142C3.21071 19.0391 3 18.5304 3 18V9C3 8.46957 3.21071 7.96086 3.58579 7.58579C3.96086 7.21071 4.46957 7 5 7Z" stroke="#515151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M11.245 15.904C11.6886 16.0194 12.1527 16.0315 12.6017 15.9396C13.0507 15.8477 13.4727 15.6541 13.8353 15.3737C14.1979 15.0933 14.4914 14.7336 14.6933 14.3221C14.8952 13.9106 15.0001 13.4584 15 13M12.75 10.095C12.3067 9.98055 11.843 9.96908 11.3946 10.0615C10.9461 10.1539 10.5247 10.3477 10.1628 10.6281C9.80081 10.9085 9.50783 11.2681 9.30628 11.6792C9.10473 12.0903 8.99996 12.5421 9 13" stroke="#515151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 13H16V15" stroke="#515151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 13H8V11" stroke="#515151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>

          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clip-path="url(#clip0_681_274)">
              <path
                d="M10.0178 0.312516C12.6064 0.317164 14.9567 1.33724 16.692 2.99552L18.0871 1.60041C18.6777 1.00982 19.6875 1.4281 19.6875 2.26334V7.50002C19.6875 8.01779 19.2678 8.43752 18.75 8.43752H13.5133C12.6781 8.43752 12.2598 7.42771 12.8504 6.83709L14.4813 5.20623C13.2756 4.07736 11.7156 3.45205 10.0582 3.43775C6.44891 3.40658 3.40652 6.32748 3.43773 10.0566C3.46734 13.5941 6.33531 16.5625 10 16.5625C11.6065 16.5625 13.1249 15.9892 14.3214 14.9392C14.5067 14.7767 14.7865 14.7866 14.9608 14.9608L16.5101 16.5101C16.7004 16.7004 16.691 17.0107 16.4913 17.1911C14.7735 18.7427 12.4971 19.6875 10 19.6875C4.64977 19.6875 0.312539 15.3503 0.3125 10.0001C0.312461 4.65599 4.67367 0.302945 10.0178 0.312516Z"
                fill="#515151"
              />
            </g>
            <defs>
              <clipPath id="clip0_681_274">
                <rect width="20" height="20" fill="white" />
              </clipPath>
            </defs>
          </svg>

          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clip-path="url(#clip0_681_272)">
              <path
                d="M9.98223 0.312516C7.39359 0.317164 5.04324 1.33724 3.30801 2.99552L1.91293 1.60045C1.3223 1.00982 0.3125 1.4281 0.3125 2.26334V7.50002C0.3125 8.01779 0.732227 8.43752 1.25 8.43752H6.48668C7.32191 8.43752 7.7402 7.42771 7.14961 6.83709L5.51875 5.20623C6.72437 4.07736 8.28441 3.45205 9.9418 3.43775C13.5511 3.40658 16.5935 6.32748 16.5623 10.0566C16.5327 13.5941 13.6647 16.5625 10 16.5625C8.39348 16.5625 6.87512 15.9892 5.67852 14.9392C5.49324 14.7767 5.21344 14.7866 5.03914 14.9608L3.48984 16.5101C3.29953 16.7004 3.30895 17.0107 3.50867 17.1911C5.22648 18.7427 7.50289 19.6875 10 19.6875C15.3502 19.6875 19.6875 15.3503 19.6875 10.0001C19.6875 4.65599 15.3263 0.302945 9.98223 0.312516Z"
                fill="#515151"
              />
            </g>
            <defs>
              <clipPath id="clip0_681_272">
                <rect width="20" height="20" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </div>
      </div>

      <div className="w-[60vw] h-full flex items-center justify-center"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          setCoordinates([x, y]);
        }}
      >
        <div className="w-full aspect-square max-h-full relative">
          <img
            src={alliance == "red" ? red_field : blue_field}
            alt="Field"
            className="w-full h-full object-contain transition-transform duration-200"
            style={{
              transform: isRotated ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
          {JSON.stringify(coordinates) != JSON.stringify([1000, 1000]) && (
            <div
              className={`absolute top-${coordinates[0]}px left-${coordinates[1]}px`}
              style={{
                left: `${coordinates[0]}px`,
                top: `${coordinates[1]}px`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clip-path="url(#clip0_717_402)">
                  <path
                    d="M2 12C0.895431 12 0 11.1046 0 10C0 8.89543 0.895431 8 2 8H18C19.1046 8 20 8.89543 20 10C20 11.1046 19.1046 12 18 12L2 12Z"
                    fill="#B73E3E"
                  />
                  <rect x="8" width="4" height="20" rx="2" fill="#B73E3E" />
                </g>
                <defs>
                  <clipPath id="clip0_717_402">
                    <rect width="20" height="20" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-center items-center w-[30vw] shrink-0 h-full gap-2.5 p-2.5 rounded-[15px]">
        <Button
          variant="secondary"
          className="w-full h-full border-[#CDA745] bg-background border-2 hover:bg-[#CDA745]/10 px-3 whitespace-normal"
          onClick={handleGoToSummary}
        >
          <p className="text-[18px] text-[#CDA745] leading-tight text-center">Go to Match Summary</p>
        </Button>
      </div>

      <div className="flex flex-col justify-start items-center w-[10vw] shrink-0 h-full px-6 py-2.5 rounded-[10px] gap-2.5 bg-background border-2 border-[#1E1E1E]">
        <p className="text-xs text-[#CDA745]">
          Done
        </p>
        <div className="relative flex flex-col gap-0 flex-1 w-1.25">
          <div
            style={{ height: "100%" }}
            className="flex flex-col w-full bg-[#CDA745]"
          ></div>
        </div>
      </div>
    </div>
    </>
  );
}
