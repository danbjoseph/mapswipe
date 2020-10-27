// @flow
import * as React from 'react';
import { Animated, Image, PanResponder, StyleSheet, View } from 'react-native';
import {
    type LayoutEvent,
    type PressEvent,
} from 'react-native/Libraries/Types/CoreEventTypes';
import type {
    GestureState,
    PanResponderInstance,
} from 'react-native/Libraries/Interaction/PanResponder';
import { Path, Shape, Surface } from '@react-native-community/art';
import tilebelt from '@mapbox/tilebelt';
import type {
    BBOX,
    Point,
    Polygon,
    SingleImageryProjectType,
    BuildingFootprintTaskType,
    Tile,
} from '../../flow-types';

const GLOBAL = require('../../Globals');

const styles = StyleSheet.create({
    tileImg: {
        position: 'absolute',
    },
});

type Props = {
    nextTask: () => boolean,
    prefetchTask: BuildingFootprintTaskType,
    previousTask: () => boolean,
    project: SingleImageryProjectType,
    task: BuildingFootprintTaskType,
};

type State = {
    animatedMarginLeft: Animated.Value,
    animatedMarginRight: Animated.Value,
};

export default class FootprintDisplay extends React.Component<Props, State> {
    panResponder: PanResponderInstance;

    swipeThreshold: number;

    // the imagery is shown as a rectangle, whose size is computed to fill
    // in the screen as much as possible. The width is the same as the screen, and
    // for the height, we rely on flexbox to size the different components, which means that the
    // first rendering is when we find out how much space we have for the imagery.
    // so we first set this value to null, and update it once flexbox has given us a height.
    // Only then can we pull imagery
    imageryHeight: number;

    // for now, this is hardcoded at 19
    zoomLevel: number;

    constructor(props: Props) {
        super(props);
        // swipeThreshold defines how much movement is needed to start considering the event
        // as a swipe. This used to be a fixed value, we now link it to screen size (through the tile size)
        // so that it should work across screen densities.
        this.swipeThreshold = GLOBAL.TILE_SIZE * 0.02;
        this.panResponder = PanResponder.create({
            onMoveShouldSetPanResponder: this.handleMoveShouldSetPanResponder,
            onMoveShouldSetPanResponderCapture: this
                .handleMoveShouldSetPanResponder,
            onPanResponderRelease: this.handlePanResponderEnd,
        });
        this.state = {
            animatedMarginLeft: new Animated.Value(0),
            animatedMarginRight: new Animated.Value(0),
        };
        this.imageryHeight = 0;
        this.zoomLevel = 19;
    }

    componentDidUpdate(prevProps: Props) {
        // try to prefetch the next task's imagery so it displays instantly when
        // we reach it
        const { prefetchTask, project } = this.props;
        if (
            prefetchTask !== prevProps.prefetchTask &&
            prefetchTask !== undefined
        ) {
            if (
                project.tileServer.url.includes('googleapis') &&
                this.imageryHeight !== 0
            ) {
                const prefetchUrl = this.getGoogleImageryUrl(
                    project.tileServer.url,
                    prefetchTask,
                    this.zoomLevel,
                    GLOBAL.SCREEN_WIDTH,
                    this.imageryHeight,
                );
                Image.prefetch(prefetchUrl);
            }
        }
    }

    onLayout = (event: LayoutEvent) => {
        const { height } = event.nativeEvent.layout;
        if (height !== this.imageryHeight) {
            this.imageryHeight = height;
            this.forceUpdate();
        }
    };

    handleMoveShouldSetPanResponder = (
        // decide if we handle the move event: only if it's horizontal
        event: PressEvent,
        gestureState: GestureState,
    ): boolean => Math.abs(gestureState.dx) > this.swipeThreshold;

    bounceImage = (direction: string) => {
        // bounce the image left or right when the user tries to swipe past what
        // they're allowed to, to give them some visual feedback
        const { animatedMarginLeft, animatedMarginRight } = this.state;
        let value;
        if (direction === 'left') {
            value = animatedMarginRight;
        } else {
            value = animatedMarginLeft;
        }
        Animated.sequence([
            Animated.timing(value, {
                toValue: 100,
                duration: 100,
                useNativeDriver: false,
            }),
            Animated.timing(value, {
                toValue: 0,
                duration: 100,
                useNativeDriver: false,
            }),
        ]).start();
    };

    handlePanResponderEnd = (event: PressEvent, gestureState: GestureState) => {
        // swipe completed, decide what to do
        const { nextTask, previousTask } = this.props;
        const swipeMinLength = 0.2;
        if (gestureState.dx < -GLOBAL.TILE_VIEW_HEIGHT * swipeMinLength) {
            const bounceAtEnd = nextTask();
            if (bounceAtEnd) {
                this.bounceImage('left');
            }
        } else if (gestureState.dx > GLOBAL.TILE_VIEW_HEIGHT * swipeMinLength) {
            const bounceAtEnd = previousTask();
            if (bounceAtEnd) {
                this.bounceImage('right');
            }
        }
    };

    /*
     * Get the polygon to draw over the image
     */
    getPolygon = (coords: Polygon, screenBBox: BBOX): Path => {
        const [minLon, minLat, maxLon, maxLat] = screenBBox;
        // geographic coords to screen pixels
        const lon2x = (lon) =>
            ((lon - minLon) / (maxLon - minLon)) * this.imageryHeight;
        const lat2y = (lat) =>
            (1 - (lat - minLat) / (maxLat - minLat)) * this.imageryHeight;
        const p = Path().moveTo(lon2x(coords[0][0]), lat2y(coords[0][1]));
        coords.forEach((corner) => {
            p.lineTo(lon2x(corner[0]), lat2y(corner[1]));
        });
        p.close();
        return p;
    };

    /*
     * Get the building bounding box (in real coordinates)
     */
    getBuildingBBox = (coords: Polygon): BBOX => {
        const lons = coords.map((p) => p[0]).sort();
        const lats = coords.map((p) => p[1]).sort();
        return [lons[0], lats[0], lons[lons.length - 1], lats[lats.length - 1]];
    };

    // return the center of the building footprint
    getTaskGeometryCentroid = (coords: Polygon): Point => {
        const centroid: Point = coords
            .slice(0, -1)
            .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]]);
        // $FlowFixMe
        return centroid.map((c) => c / (coords.length - 1));
    };

    // return a bouding box to zoom to as [W, S, E, N]
    // which has the same size as a tile at these coordinates and zoom level
    getScreenBBoxFromCenter = (center: Point, zoom: number): BBOX => {
        const lon = center[0];
        const lat = center[1];
        const centerTile = tilebelt.pointToTile(lon, lat, zoom);
        // calculate width and height of the tile in degrees
        const tileBBOX = tilebelt.tileToBBOX(centerTile);
        const tileW = tileBBOX[2] - tileBBOX[0];
        const tileH = tileBBOX[3] - tileBBOX[1];
        return [
            lon - tileW / 2,
            lat - tileH / 2,
            lon + tileW / 2,
            lat + tileH / 2,
        ];
    };

    latLonZoomToPixelCoords = (lonLat: Point, zoom: number): Point => {
        // returns the point in pixel coords for the given zoom level.
        // https://docs.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system#pixel-coordinates
        // for more details on pixel coords
        const [lon, lat] = lonLat;
        const sinLat = Math.sin((lat * Math.PI) / 180);
        const x = ((lon + 180) / 360) * 256 * 2 ** zoom;
        const y =
            (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
            256 *
            2 ** zoom;
        return [Math.floor(x), Math.floor(y)];
    };

    pixelCoordsToImageCoords = (
        pointPixelCoords: Point,
        minX: number, // pixel coord of left side of the screen
        minY: number, // pixel coord of top of the screen
    ): Point => {
        return [pointPixelCoords[0] - minX, pointPixelCoords[1] - minY];
    };

    getGooglePolygonFromCenter = (
        center: Point,
        zoom: number,
        taskCoords: Polygon,
    ): Path => {
        // get the polygon in ART Path format, expressed in image coordinates,
        // for the task geometry. Arguments:
        // center: the center as [longitude, latitude]
        // zoom: standard zoom level
        // taskCoords: the coordinates of the task geometry, each point as [lon, lat]
        // This only works for google imagery

        // get bounding box coordinates in geographic pixels
        const centerPixelCoords = this.latLonZoomToPixelCoords(center, zoom);
        const minX = centerPixelCoords[0] - GLOBAL.SCREEN_WIDTH / 2;
        const minY = centerPixelCoords[1] - this.imageryHeight / 2;

        // geographic coords to screen pixels
        const taskImageCoords = taskCoords.map((tc) =>
            this.pixelCoordsToImageCoords(
                this.latLonZoomToPixelCoords(tc, zoom),
                minX,
                minY,
            ),
        );

        const p = Path().moveTo(taskImageCoords[0][0], taskImageCoords[0][1]);
        taskImageCoords.forEach((corner) => {
            p.lineTo(corner[0], corner[1]);
        });
        return p;
    };

    BBOXToCoords = (bbox: BBOX): Polygon => {
        const [w, s, e, n] = bbox;
        return [
            [w, s],
            [w, n],
            [e, n],
            [e, s],
        ];
    };

    getTilesFromScreenCorners = (corners: Polygon, z: number) => {
        const sw = tilebelt.pointToTile(corners[0][0], corners[0][1], z);
        const nw = [sw[0], sw[1] - 1, z];
        const ne = [nw[0] + 1, nw[1], z];
        const se = [ne[0], sw[1], z];
        return [sw, nw, ne, se];
    };

    getTileUrl = (tile: Tile): string => {
        const { project } = this.props;
        const quadKey = tilebelt.tileToQuadkey(tile);
        // $FlowFixMe
        const url = project.tileServer.url
            .replace('{quad_key}', quadKey)
            // $FlowFixMe
            .replace('{key}', project.tileServer.apiKey);
        return url;
    };

    getTaskCenter = (task: BuildingFootprintTaskType): Point => {
        if (task.center) {
            return task.center;
        }
        return this.getTaskGeometryCentroid(task.geojson.coordinates[0]);
    };

    getGoogleImageryUrl = (
        urlTemplate: string,
        task: BuildingFootprintTaskType,
        zoom: number,
        width: number,
        height: number,
    ) => {
        // return the url required to download imagery
        // google imagery is returned as a single image of the size we want
        // so we need a different logic, as we can't just pull 4 images
        // (each call costs money, and would include a credit line)
        const googleSize = `${width}x${height}`;
        // some projects include a `center` attribute in the task which defines
        // the center point of the imagery to use. This allows some optimisation
        // of number of imagery requests by reusing the same image for multiple
        // tasks.
        const center = this.getTaskCenter(task); // the geometry center
        const googleCenterString = `${center[1]}%2C%20${center[0]}`;

        const imageUrl = urlTemplate
            .replace('{z}', zoom.toString())
            .replace('{size}', googleSize)
            .replace('{center}', googleCenterString);
        return imageUrl;
    };

    getTaskGeometryPath = (
        task: BuildingFootprintTaskType,
        zoom: number,
    ): Path => {
        const center = this.getTaskCenter(task); // the geometry center
        return this.getGooglePolygonFromCenter(
            center,
            zoom,
            task.geojson.coordinates[0],
        );
    };

    render = () => {
        const { project, task } = this.props;
        const { animatedMarginLeft, animatedMarginRight } = this.state;
        if (task.geojson === undefined || this.imageryHeight === 0) {
            // data is not ready yet, just show a placeholder
            return (
                <View
                    onLayout={this.onLayout}
                    style={{
                        flex: 1,
                        width: GLOBAL.SCREEN_WIDTH,
                    }}
                />
            );
        }
        const coords = task.geojson.coordinates[0];
        const imageUrl = this.getGoogleImageryUrl(
            project.tileServer.url,
            task,
            this.zoomLevel,
            GLOBAL.SCREEN_WIDTH,
            this.imageryHeight,
        );
        const path = this.getTaskGeometryPath(task, this.zoomLevel);

        if (project.tileServer.url.includes('googleapis')) {
            return (
                <Animated.View
                    {...this.panResponder.panHandlers}
                    style={{
                        alignSelf: 'center',
                        height: this.imageryHeight,
                        marginLeft: animatedMarginLeft,
                        marginRight: animatedMarginRight,
                        width: GLOBAL.SCREEN_WIDTH,
                        overflow: 'hidden',
                    }}
                >
                    <Image
                        style={{
                            left: 0,
                            height: this.imageryHeight,
                            position: 'absolute',
                            width: GLOBAL.SCREEN_WIDTH,
                            top: 0,
                        }}
                        source={{ uri: imageUrl }}
                    />
                    <Surface
                        height={this.imageryHeight}
                        width={GLOBAL.SCREEN_WIDTH}
                    >
                        <Shape d={path} stroke="red" strokeWidth={1} />
                    </Surface>
                </Animated.View>
            );
        }
        // all other imagery sources work with 4 tiles shown at the same time
        // get 4 tiles at zoomLevel and shift them as needed
        const center = this.getTaskGeometryCentroid(coords);
        const screenBBox = this.getScreenBBoxFromCenter(center, this.zoomLevel);
        // build footprint polyline
        const p = this.getPolygon(coords, screenBBox);
        const corners = this.BBOXToCoords(screenBBox);
        const swCornerTile = tilebelt.pointToTileFraction(
            corners[0][0],
            corners[0][1],
            this.zoomLevel,
        );
        const tiles = this.getTilesFromScreenCorners(corners, this.zoomLevel);
        const tileUrls = tiles.map(this.getTileUrl);

        const shiftX = (swCornerTile[0] % 1) * this.imageryHeight;
        const shiftY = (swCornerTile[1] % 1) * this.imageryHeight;
        return (
            <View
                {...this.panResponder.panHandlers}
                style={{
                    height: this.imageryHeight,
                    overflow: 'hidden',
                    width: this.imageryHeight,
                }}
            >
                <View
                    style={{
                        position: 'absolute',
                        left: -shiftX,
                        top: -shiftY,
                        height: this.imageryHeight * 2,
                        width: this.imageryHeight * 2,
                    }}
                >
                    <Image
                        style={[
                            {
                                left: 0,
                                top: 0,
                            },
                            styles.tileImg,
                        ]}
                        source={{ uri: tileUrls[1] }}
                    />
                    <Image
                        style={[
                            {
                                left: this.imageryHeight,
                                top: 0,
                            },
                            styles.tileImg,
                        ]}
                        source={{ uri: tileUrls[2] }}
                    />
                    <Image
                        style={[
                            {
                                left: 0,
                                top: this.imageryHeight,
                            },
                            styles.tileImg,
                        ]}
                        source={{ uri: tileUrls[0] }}
                    />
                    <Image
                        style={[
                            {
                                left: this.imageryHeight,
                                top: this.imageryHeight,
                            },
                            styles.tileImg,
                        ]}
                        source={{ uri: tileUrls[3] }}
                    />
                </View>
                <Surface
                    height={GLOBAL.SCREEN_WIDTH}
                    width={GLOBAL.SCREEN_WIDTH}
                >
                    <Shape d={p} stroke="red" strokeWidth={2} />
                </Surface>
            </View>
        );
    };
}
