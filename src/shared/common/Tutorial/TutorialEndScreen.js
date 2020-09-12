// @flow
import * as React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import fb from 'react-native-firebase';
import { firebaseConnect } from 'react-redux-firebase';
import { StyleSheet, Text, View } from 'react-native';
import { withTranslation } from 'react-i18next';
import Button from 'apsl-react-native-button';
import TutorialOutroScreen from './TutorialOutro';
import { cancelGroup } from '../../actions/index';
import type {
    GroupType,
    NavigationProp,
    TranslationFunction,
} from '../../flow-types';
import {
    COLOR_CHECKMARK_GREEN,
    COLOR_DEEP_BLUE,
    COLOR_RED,
    COLOR_WHITE,
} from '../../constants';

const GLOBAL = require('../../Globals');

const styles = StyleSheet.create({
    congratulationsSlide: {
        width: GLOBAL.SCREEN_WIDTH,
        height: '100%',
        borderWidth: 0,
        backgroundColor: COLOR_DEEP_BLUE,
        justifyContent: 'center',
        flexDirection: 'column',
        alignItems: 'center',
    },
    startButton: {
        alignSelf: 'center',
        backgroundColor: COLOR_RED,
        fontWeight: 'bold',
        marginTop: 20,
        width: '90%',
        height: 50,
        padding: 12,
        borderRadius: 25,
        borderWidth: 0.1,
    },
    centeredHeader: {
        alignSelf: 'center',
        color: COLOR_WHITE,
        fontWeight: '700',
        fontSize: 18,
        marginBottom: 20,
        marginTop: 40,
    },
    greenCheckMark: {
        backgroundColor: COLOR_CHECKMARK_GREEN,
        borderRadius: 64,
        color: COLOR_WHITE,
        fontWeight: 'bold',
        fontSize: 96,
        paddingLeft: 32,
        width: 128,
    },
    finishedText: {
        fontSize: 17,
        textAlign: 'justify',
        color: COLOR_WHITE,
        marginBottom: 30,
        width: '90%',
    },
    oneScreenWidth: {
        width: GLOBAL.SCREEN_WIDTH,
    },
    twoScreensWidth: {
        flex: 1,
        flexDirection: 'row',
        width: GLOBAL.SCREEN_WIDTH * 2,
    },
});

type Props = {
    group: GroupType,
    navigation: NavigationProp,
    onCancelGroup: ({}) => void,
    projectId: string,
    t: TranslationFunction,
};

class TutorialEndScreen extends React.Component<Props> {
    onComplete = () => {
        const { group, navigation, onCancelGroup } = this.props;
        fb.analytics().logEvent('finish_tutorial');
        // this prevents the tutorial from showing
        // results from a previous run
        onCancelGroup({
            groupId: group.groupId,
            projectId: group.projectId,
        });
        navigation.pop();
    };

    _onBack = () => {
        const { navigation } = this.props;
        navigation.pop();
    };

    render() {
        const { t } = this.props;
        return (
            <View style={styles.twoScreensWidth}>
                <View style={styles.oneScreenWidth}>
                    <TutorialOutroScreen />
                </View>
                <View style={styles.oneScreenWidth}>
                    <View style={styles.congratulationsSlide}>
                        <Text style={styles.greenCheckMark}>&#x2713;</Text>
                        <Text style={styles.centeredHeader}>
                            {t('readyToStart')}
                        </Text>
                        <Text style={styles.finishedText}>
                            {t('completedTutorial')}
                        </Text>

                        <Button
                            style={styles.startButton}
                            onPress={this.onComplete}
                            textStyle={{ fontSize: 18, color: COLOR_WHITE }}
                        >
                            {t('startMapping')}
                        </Button>
                    </View>
                </View>
            </View>
        );
    }
}

const mapStateToProps = (state, ownProps) => ({
    navigation: ownProps.navigation,
    results: state.results,
});

const mapDispatchToProps = (dispatch) => ({
    onCancelGroup(groupDetails) {
        dispatch(cancelGroup(groupDetails));
    },
});

export default compose(
    withTranslation('TutorialEndScreen'),
    firebaseConnect(),
    connect(mapStateToProps, mapDispatchToProps),
)(TutorialEndScreen);
