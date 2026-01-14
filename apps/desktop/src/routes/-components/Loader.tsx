import { Dot } from "lucide-react";

export function Loader({ loadingText }: { loadingText?: string }) {
	return (
		<div className="flex flex-col items-center justify-center h-full w-full gap-1">
			<div className="text-sm text-muted-foreground">
				{loadingText || "Loading"}
			</div>
			<div className="flex flex-row">
				{[0, 200, 400, 600, 800, 1000].map((delay, i) => (
					<Dot
						key={i}
						className="animate-pulse m-[-0.4rem]"
						style={{ animationDelay: `${delay}ms` }}
					/>
				))}
			</div>
		</div>
	);
}
