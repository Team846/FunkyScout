import { fetchEventVideo } from "../tba/index";


const data = await fetchEventVideo("2025caav");

if (data)
{
    console.log(data.data[0].videos[0].key);
    //console.log(data.videos[0].key + " " + data.videos[0].type)
}